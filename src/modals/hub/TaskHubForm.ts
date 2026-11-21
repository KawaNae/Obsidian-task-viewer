import { DateUtils } from '../../utils/DateUtils';
import type { App } from 'obsidian';
import { t } from '../../i18n';
import { type Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { IndexReads } from '../../services/core/TaskIndex';
import { DateFieldGroup } from '../form/DateFieldGroup';
import { PROPERTY_ICONS } from '../../constants/propertyIcons';
import { IssueBoard, type FormIssue, type IssueSlot } from '../form/FormIssue';
import { TaskUpdateBuilder } from '../form/TaskUpdateBuilder';
import type { DateGroupKey, DateKey } from '../form/DateFieldGroup';
import type { DateTimeFields } from '../TaskDateValidator';
import type { CloseAnswer } from '../../views/sharedUI/CloseGate';
import { DraftGuard, type Loss } from '../form/DraftGuard';
import { FormActions } from '../form/FormActions';
import type { ClosingPart, FieldGroupContext, HubField, UnsavedField } from './fields/FieldGroupContext';
import { NameField } from './fields/NameField';
import { StatusField } from './fields/StatusField';
import { TagsFieldGroup } from './fields/TagsFieldGroup';
import { StyleFieldGroup } from './fields/StyleFieldGroup';
import { PropertiesFieldGroup } from './fields/PropertiesFieldGroup';
import { hubFindings, lineOfFinding, lockedFields, type FindingField, type HubFinding } from './HubFindings';
import type { HubForm, HubHost } from './HubHost';
import { focusField, type FieldFocus, type SelectionOnFocus } from '../../utils/FieldFocus';

export type TaskHubFocusField =
    | 'name' | 'status' | 'start' | 'end' | 'due'
    | 'tags' | 'color' | 'linestyle' | 'mask' | 'properties'
    | `property:${string}`;

/**
 * How the text of each of the hub's fields is met as the focus comes to it,
 * the hub opening on it or its menu asking for it. A date, a time, a line
 * style and a colour are values of fixed shape, retyped whole: their text is
 * selected. A name, a tag, a mask and a property are free texts added to or
 * mended: the caret goes after them, so a key pressed by a slip does not
 * replace them. The status is a button, focused alone.
 */
export function selectionOnFocus(field: TaskHubFocusField): SelectionOnFocus | undefined {
    switch (field) {
        case 'start': case 'end': case 'due':
        case 'linestyle': case 'color':
            return 'all';
        case 'status':
            return undefined;
        default:
            return 'end';
    }
}

export interface TaskHubFormDeps {
    app: App;
    plugin: PluginContext;
    index: IndexReads;
    /** Ask the hub to close, as the user would (`OverlayShell.requestClose`): what a close the user said to go on with does. */
    requestClose?: () => void;
}

/**
 * タスクハブのプロパティ編集フォーム。
 *
 * 値はホスト（`HubHost`）から読み、フィールド確定（blur / Enter /
 * picker・clear / 選択）ごとに差分だけをホストへ渡す（`HubHost.put`）。
 * いつ、どこへ書くかはホストが決める。Save ボタンは持たない。
 *
 * 欄は `bindField` で値に結ぶ。打った値は欄の codec で読み、読めない値は
 * 欄の下に理由を出して保存しない。外部変更（自分の書き込みの echo を含む）
 * は refresh(fresh) で `BoundField.set` を通して取り込み、イベントを投げない。
 * 打ちかけの字がある欄と IME の変換中の欄は取り込まない — 欄の字が、欄に
 * 最後に入れた値の字と違うかで見分ける。フラグや世代カウンタは持たない。
 *
 * 誤りと注意は `IssueBoard` が持ち、出どころ（欄の名前、日付の規則、
 * フォームが閉じている理由、書き込みの拒否）ごとに置き換える。出す場所は
 * 欄の行の下とフォームの末尾である。行が日付の規則を破っていれば（規則4
 * など）、開いたときから破れた欄の下に出す。
 *
 * 書き込みの拒否はホストが言う: 拒まれた理由はフォームの末尾に出す
 * （`HubForm.sayWrite`）。拒まれた欄は打った値のまま残り（`bindField`）、
 * もう一度確定すれば新しい版へ書く。
 *
 * 閉じる手順（{@link beforeClose}）: ×、Escape、
 * 外側、下へ払う、戻るのどれも、blur を待たずに打ちかけの欄を明示して保存する。
 * 保存できない値（読めない値、日付の規則に反する値）が残れば閉じずに問い
 * （`DraftGuard`）、[直す] にフォーカスを置く。[捨てて閉じる] はその値を
 * 元に戻し、ほかの欄を保存して閉じる。まだ書いていないタスク（`HubHost.draft`）
 * では、閉じると失うのは下書きの全部なので、問いは「まだ作成していません。
 * 捨てますか」の1種類で、[捨てて閉じる] と [戻る] で答える。保存できない値が
 * あるとき、または欄を保存した後に何か入れていれば問う。保存の後にも問うのは、
 * 名前を打って blur せずに閉じたときに、問わずに名前を失わないためである。
 * [戻る] は保存できない欄に、無ければ名前の欄にフォーカスを置く。どちらの
 * ハブでも、[捨てて閉じる] と答えた後はその閉じる手順の中でもう問わない。
 * 最後に、閉じてよいかをホストに聞く（`HubHost.closing`）。欄が止まって
 * いる間は、何も保存せず、問わずにホストに聞く。
 *
 * まだ書いていないタスクには [作成] を出す（{@link create}）。押すと、読めない
 * 打ちかけの欄があれば作らずにその欄へフォーカスを置き、無ければ打ちかけの
 * 欄を保存してから作る。欄の Enter は欄を確定するだけで、作らない。
 *
 * 欄の DOM 構築とコミット/echo の取り込みは欄の部品が持つ: 名前、状態、
 * タグ、スタイル、プロパティは `fields/` 配下、日付は `DateFieldGroup`。
 * 欄の部品は自前の task コピーを持たず、`FieldGroupContext.task`
 * 経由でホストの値を都度読み、値は `put` でホストに渡す。本体は欄の並び、
 * 誤りの出す場所、所見、閉じる手順を持つ。
 */
export class TaskHubForm implements HubForm {
    /** Whether to throw away what a close would lose (values it cannot save, a task not written yet), asked before it closes. */
    private readonly guard: DraftGuard<'close'>;
    /** The user said to throw away what the close would lose: the close that goes on asks nothing more. */
    private thrownAway = false;
    private actions!: FormActions;
    private fieldCtx: FieldGroupContext;
    private readonly issues: IssueBoard<HubField>;
    /** Where the form says what is of it as a whole: at its end. */
    private readonly formSays: HTMLElement;
    /** The row's own findings as last read (`hubFindings`), and the fields they lock. */
    private findings: readonly HubFinding[] = [];
    private locks: ReadonlySet<FindingField> = new Set();

    private nameField: NameField;
    private statusField: StatusField;
    private dateGroup: DateFieldGroup;
    private tagsField: TagsFieldGroup;
    private styleField: StyleFieldGroup;
    private propsField: PropertiesFieldGroup;

    constructor(
        private container: HTMLElement,
        private readonly host: HubHost,
        private deps: TaskHubFormDeps,
    ) {
        this.formSays = container.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<HubField>({
            field: (at) => this.slotOf(at),
            form: this.formSays,
        });
        this.guard = new DraftGuard<'close'>({
            loss: () => this.loss(),
            render: () => this.renderActions(),
            asked: () => this.actions.focusKeep(),
            goOn: () => {
                this.thrownAway = true;
                this.discardUnsaved();
                this.deps.requestClose?.();
            },
        });
        this.fieldCtx = {
            task: () => this.host.task(),
            isShut: () => this.shut,
            put: (updates) => this.host.put(updates),
            app: deps.app,
            plugin: deps.plugin,
            index: deps.index,
            openSource: this.host.openSource,
            issues: this.issues,
            findings: () => this.findings,
            locked: (field) => this.locks.has(field),
        };
        this.readFindings();
        this.render();
        this.sayFindings();
        host.bind(this);
    }

    // ==================== DOM 構築 ====================

    private render(): void {
        const c = this.container;
        c.addClass('tv-form'); // _form.css の行文法（ラベル列幅など）の適用ルート

        // --- Name ---
        const nameGroup = c.createDiv({ cls: 'tv-form__group' });
        this.nameField = new NameField(nameGroup, this.fieldCtx);

        // --- Status + Start / End / Due ---
        const scheduleGroup = c.createDiv({ cls: 'tv-form__group' });
        this.statusField = new StatusField(scheduleGroup, this.fieldCtx);
        this.dateGroup = new DateFieldGroup(scheduleGroup, {
            labels: { start: t('modal.start'), end: t('modal.end'), due: t('modal.due') },
            icons: { start: PROPERTY_ICONS.start, end: PROPERTY_ICONS.end, due: PROPERTY_ICONS.due },
            current: () => dateFieldsOf(this.host.task()),
            buildOverlayTask: (f) => ({
                ...this.host.task(),
                startDate: f.startDate || undefined,
                startTime: f.startTime || undefined,
                endDate: f.endDate || undefined,
                endTime: f.endTime || undefined,
                due: DateUtils.joinDateTime(f.dueDate, f.dueTime),
            }),
            getStartHour: () => this.deps.plugin.settings.startHour,
            taskLookup: (id) => this.deps.index.getTask(id),
            getValidationCtx: () => ({
                hasImplicitStartDate: !!this.host.task().cascadeContext?.startDate,
                implicitStartDate: this.host.task().cascadeContext?.startDate,
            }),
            onCommit: (group, f) => this.commitDates(group, f),
            issues: (issues) => this.issues.set('dates', issues),
        });

        // --- Tags ---
        const tagsGroup = c.createDiv({ cls: 'tv-form__group' });
        this.tagsField = new TagsFieldGroup(tagsGroup, this.fieldCtx);

        // --- Color / Linestyle / Mask ---
        const styleGroup = c.createDiv({ cls: 'tv-form__group' });
        this.styleField = new StyleFieldGroup(styleGroup, this.fieldCtx);

        // --- Custom properties ---
        c.createEl('h4', { text: t('modal.hub.properties'), cls: 'tv-form__section-label' });
        const propsGroup = c.createDiv({ cls: 'tv-form__group' });
        this.propsField = new PropertiesFieldGroup(propsGroup, this.fieldCtx);

        // What is of the form as a whole is said at its end, and the question a close puts under it.
        c.appendChild(this.formSays);
        this.actions = new FormActions(c, {
            actions: this.host.draft
                ? [{ label: t('modal.create'), busyLabel: t('modal.newTask.creating'), tone: 'cta', run: () => this.create() }]
                : [],
            ask: {
                discardLabel: t('modal.hub.unsavedDiscard'),
                keepLabel: t('modal.hub.unsavedFix'),
                discard: () => this.guard.discard(),
                keep: () => this.fix(),
            },
        });
        // Typing in a field while asked is fixing it: the question is withdrawn.
        c.addEventListener('input', () => { this.guard.withdraw(); });
        this.renderActions();

        // The row's dates as it opens: their placeholders, and a rule the line
        // breaks (rule 4) said under the field it is of, as the editor's menu
        // says it — a row that breaks one is drawn in no view.
        this.dateGroup.refresh();
    }

    /** Where the field `at` says its issues now; null for a row that is not there. */
    private slotOf(at: HubField): IssueSlot | null {
        if (at === 'name') return this.nameField?.slot() ?? null;
        if (at === 'tags') return this.tagsField?.slot() ?? null;
        if (at === 'color' || at === 'linestyle' || at === 'mask') return this.styleField?.slot(at) ?? null;
        if (at === 'propKey' || at.startsWith('prop:')) return this.propsField?.slot(at) ?? null;
        return this.dateGroup?.slot(at as DateKey) ?? null;
    }

    // ==================== 所見 ====================

    /** Read the row's findings and the fields they lock from the model. */
    private readFindings(): void {
        this.findings = hubFindings(this.host.task(), this.deps.plugin.settings.scopeKeys);
        this.locks = lockedFields(this.findings);
    }

    /**
     * Say each finding under the field it is of (the form's at its end),
     * with the line to open in the editor: the user fixes the block there.
     * With no row to open (`HubHost.openSource` null), nothing is offered.
     */
    private sayFindings(): void {
        const open = this.host.openSource;
        this.issues.set('findings', this.findings.map(finding => ({
            at: finding.field,
            tone: finding.tone,
            text: finding.text,
            ...(open && {
                action: {
                    label: t('modal.hub.openLine'),
                    run: () => {
                        const among = this.findings;
                        open(row => (row === this.host.task()
                            ? { line: finding.line }
                            : { line: lineOfFinding(finding, among, row, this.deps.plugin.settings.scopeKeys) }));
                    },
                },
            }),
        })));
    }

    // ==================== コミット ====================

    private commitDates(group: DateGroupKey, f: DateTimeFields): Promise<boolean> | void {
        if (this.shut) return;
        const task = this.host.task();
        const updates =
            group === 'start' ? TaskUpdateBuilder.dateGroup(task, 'start', f.startDate, f.startTime)
            : group === 'end' ? TaskUpdateBuilder.dateGroup(task, 'end', f.endDate, f.endTime)
            : TaskUpdateBuilder.due(task, f.dueDate, f.dueTime);
        return this.host.put(updates);
    }

    // ==================== 閉じる手順 ====================

    /**
     * Whether the hub may close now (the panel asks it after the source mode):
     * every field typed in and not committed is saved, as a blur would, with no
     * blur waited for. A value that cannot be saved keeps the hub open and asks
     * whether to throw it away (`'stay'`); on a task not written yet, so does
     * anything it was given, and what is asked about is the whole task. Saved, the host
     * answers (`HubHost.closing`). While the form is shut nothing is saved
     * and nothing asked: the host answers at once (a create under way is
     * waited for).
     */
    beforeClose(): CloseAnswer {
        const goes = this.shut || this.saveForClose();
        // What the user said to throw away is thrown away for the close it was said for, and no later one.
        this.thrownAway = false;
        return goes ? this.host.closing() : 'stay';
    }

    /**
     * Save every field for a close, as a blur would: whether it goes on. Not
     * when a value cannot be saved, nor when, saved, a task not written yet
     * holds what was given (all that was typed is in it only now): the
     * question is put then.
     */
    private saveForClose(): boolean {
        if (!this.guard.request('close')) return false;
        for (const part of this.parts()) part.save();
        return this.guard.request('close');
    }

    // ==================== 作成 ====================

    /**
     * Create the task not written yet, as the fields hold it: a value typed
     * that does not read keeps it from being created, and takes the focus
     * (why is said under it); what is typed and reads is put in first, as a
     * close saves it. A question a close put is withdrawn: creating is
     * acting on what it was about.
     */
    private create(): void {
        const draft = this.host.draft;
        if (!draft?.canCreate()) return;
        this.guard.withdraw();
        const first = this.unsaved()[0];
        if (first) {
            first.input.focus();
            return;
        }
        for (const part of this.parts()) part.save();
        draft.create();
    }

    /** The parts of the form a close asks: the name, the dates, the style, the tags and the properties. */
    private parts(): ClosingPart[] {
        const dates: ClosingPart = {
            unsaved: () => this.dateGroup.unsaved().map(key => ({ label: this.dateGroup.labelOf(key), input: this.dateGroup.getInput(key) })),
            discardUnsaved: () => this.dateGroup.discardUnsaved(),
            save: () => this.dateGroup.save(),
        };
        return [this.nameField, dates, this.styleField, this.tagsField, this.propsField];
    }

    private unsaved(): UnsavedField[] {
        return this.parts().flatMap(part => part.unsaved());
    }

    /**
     * What a close would lose. On a row, the values that cannot be saved, by
     * their fields' names: the rest is written as it is saved. On a task not
     * written yet, the whole of it, once it was given anything: a value typed
     * that cannot be saved, or a change saved (`HubDraft.changed`). Nothing
     * once the user said to throw it away.
     */
    private loss(): Loss | null {
        if (this.shut || this.thrownAway) return null;
        const fields = this.unsaved();
        const draft = this.host.draft;
        if (draft) return fields.length > 0 || draft.changed() ? { kind: 'draft' } : null;
        return fields.length > 0 ? { kind: 'unsaved', fields: fields.map(one => one.label) } : null;
    }

    /** Throw away what cannot be saved, as the close said to: those fields show their values again. */
    private discardUnsaved(): void {
        for (const part of this.parts()) part.discardUnsaved();
    }

    /**
     * Keep, as asked: the question is withdrawn, and the first field that
     * cannot be saved takes the focus; with none (a task not written yet
     * kept), the name, the first of the fields.
     */
    private fix(): void {
        const first = this.unsaved()[0];
        this.guard.keep();
        (first?.input ?? this.nameField.fieldElement())?.focus();
    }

    /**
     * The buttons at the form's end: the question a close puts, its answer
     * that keeps reading as what it keeps (the value to fix, the task to
     * go on with), and the create as the host's draft says.
     */
    private renderActions(): void {
        const loss = this.guard.asking;
        const draft = this.host.draft;
        const ask = loss?.kind === 'unsaved'
            ? t('modal.hub.unsavedAsk', { fields: loss.fields.join(t('modal.hub.fieldJoin')) })
            : loss?.kind === 'draft' ? t('modal.newTask.discardAsk') : null;
        this.actions.render({
            busy: draft?.creating() ?? false,
            ctaEnabled: draft?.canCreate() ?? false,
            ask,
            ...(loss?.kind === 'draft' && { keep: t('modal.draft.keep') }),
        });
    }

    // ==================== 外部変更の取り込み ====================

    /**
     * ホストの値をフォームへ反映する（自書き込みの echo / 外部編集 / 拒否の後の写し）。
     * focus 中・IME composition 中のフィールドはスキップ。
     */
    refresh(): void {
        this.readFindings();
        this.nameField.refresh();
        this.statusField.refresh();
        this.dateGroup.set(dateFieldsOf(this.host.task()));
        this.styleField.refresh();
        this.tagsField.refresh();
        this.propsField.refresh();
        this.sayFindings();
    }

    sayWrite(refusal: string | null): void {
        this.issues.set('write', refusal === null ? [] : [{ at: 'form', tone: 'error', text: refusal }]);
    }

    sayPlace(issues: readonly FormIssue<never>[]): void {
        this.issues.set('place', issues);
    }

    showDraft(): void {
        this.renderActions();
    }

    /** Whether the form takes no edit: the host says why (`HubHost.shut`). */
    private get shut(): boolean {
        return this.host.shut() !== null;
    }

    /** The fields enabled or not, and the notice of why not, as the host says. */
    showShut(): void {
        const notice = this.host.shut();
        this.setEnabled(notice === null);
        this.issues.set('shut', notice ? [{ at: 'form', tone: 'warning', text: notice }] : []);
    }

    private setEnabled(enabled: boolean): void {
        this.nameField?.setEnabled(enabled);
        this.statusField?.setEnabled(enabled);
        this.dateGroup?.setEnabled(enabled);
        this.styleField?.setEnabled(enabled);
        // tags / props の動的セクションは shut を見て再構築する
        this.tagsField?.setEnabled(enabled);
        this.propsField?.setEnabled(enabled);
    }

    // ==================== focus ====================

    /** Focus the field named, its text met as its kind asks (a property of the hub's menu). */
    focusField(field: TaskHubFocusField): void {
        const to = this.focusOf(field);
        if (to) focusField(to);
    }

    /**
     * Where the focus goes for the field named, and how its text is met
     * there (`selectionOnFocus`): what the hub opens on (`initialFocus`)
     * and what the menu focuses alike. Null when the form has no such field.
     */
    focusOf(field: TaskHubFocusField): FieldFocus | null {
        const to = this.fieldElement(field);
        return to ? { to, selection: selectionOnFocus(field) } : null;
    }

    /** The element of the field named. */
    fieldElement(field: TaskHubFocusField): HTMLElement | null {
        if (field.startsWith('property:')) {
            return this.propsField.fieldElement(field.slice('property:'.length));
        }
        switch (field) {
            case 'name': return this.nameField.fieldElement();
            case 'status': return this.statusField.fieldElement();
            case 'start': return this.dateGroup?.getInput('startDate');
            case 'end': return this.dateGroup?.getInput('endDate');
            case 'due': return this.dateGroup?.getInput('dueDate');
            case 'tags': return this.tagsField.fieldElement();
            case 'color': return this.styleField?.getInput('color') ?? null;
            case 'linestyle': return this.styleField?.getInput('linestyle') ?? null;
            case 'mask': return this.styleField?.getInput('mask') ?? null;
            case 'properties': return this.propsField.fieldElement();
            default: return null;
        }
    }

}

/** A row's dates as the six fields hold them, `''` for none; the due's date and time apart. */
function dateFieldsOf(task: Task): DateTimeFields {
    const due = DateUtils.splitDateTime(task.due ?? '');
    return {
        startDate: task.startDate || '',
        startTime: task.startTime || '',
        endDate: task.endDate || '',
        endTime: task.endTime || '',
        dueDate: due.date || '',
        dueTime: due.time || '',
    };
}
