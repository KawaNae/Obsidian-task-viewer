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
import { CreateLine } from './CreateLine';
import type { ClosingPart, FieldGroupContext, HubField, UnsavedField } from './fields/FieldGroupContext';
import { NameField } from './fields/NameField';
import { StatusField } from './fields/StatusField';
import { TagsFieldGroup } from './fields/TagsFieldGroup';
import { StyleFieldGroup } from './fields/StyleFieldGroup';
import { PropertiesFieldGroup } from './fields/PropertiesFieldGroup';
import { hubFindings, lineOfFinding, lockedFields, type FindingField, type HubFinding } from './HubFindings';
import type { HubForm, HubHost, HubPlace, HubShut, PlaceMaker } from './HubHost';
import type { FieldFocus, SelectionOnFocus } from '../../utils/FieldFocus';
import { placeFocus } from '../../views/sharedUI/FocusPlacement';
import { TabStrip } from '../../views/sharedUI/TabStrip';

export type TaskHubFocusField =
    | 'name' | 'status' | 'start' | 'end' | 'due'
    | 'tags' | 'color' | 'linestyle' | 'mask' | 'properties'
    | `property:${string}`
    /** The first field of the place's group (`TaskHubFormDeps.place`). */
    | 'place';

/**
 * The form's two tabs. The basic one holds what a task is made with: the
 * name, the status, the dates and the place. The details hold what is
 * mostly given by the section or the note: the tags, the colour, the line
 * style, the mask and the properties.
 */
export type HubTab = 'basic' | 'detail';

/** The tab the field named is in. */
export function tabOf(field: TaskHubFocusField): HubTab {
    switch (field) {
        case 'name': case 'status': case 'start': case 'end': case 'due': case 'place':
            return 'basic';
        default:
            return 'detail';
    }
}

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
    /**
     * Where the row of buttons goes: the overlay's foot (`OverlayFrame`),
     * which stays in sight below the fields as they scroll.
     */
    foot: HTMLElement;
    /**
     * Builds where the task goes, as the last group of the basic tab: its
     * fields are shut only with the whole form (`HubShut.reach`), focused
     * as `'place'`, and typing in them withdraws a close's question as the
     * form's own do. None on a hub that says no place.
     */
    place?: PlaceMaker;
    /** The field the hub opens on: the form is built on its tab. None: the basic tab. */
    opensOn?: TaskHubFocusField;
    /** Whether the focus is in the hub now, on anything but its panel holding it. None: taken as not. */
    hasFocus?: () => boolean;
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
 * 欄は「基本」と「詳細」の2つのタブ（`TabStrip`）に分けて置く。どの欄が
 * どちらのタブにあるかはフォームが知る（`tabOf`）。初めのタブは開くときの
 * 欄のタブで、欄にフォーカスを置くときは、先にその欄のタブを選ぶ。
 *
 * 誤りと注意は `IssueBoard` が持ち、出どころ（欄の名前、日付の規則、
 * フォームが閉じている理由、書き込みの拒否）ごとに置き換える。出す場所は
 * 欄の行の下と、フォーム全体の文の場所（タブの行の上）である。2つのタブの
 * どちらを見ていても見えるためである。行が日付の規則を破っていれば（規則4
 * など）、開いたときから破れた欄の下に出す。
 *
 * 欄から渡した変更の拒否はホストが言う（`HubForm.sayPut`）。拒まれた理由は
 * フォーム全体の文の場所に出す。拒まれた欄は打った値のまま残り（`bindField`）、
 * もう一度確定すれば新しい版へ書く。
 *
 * ホストがまだ書いていないもの（`HubHost.draft`）を持つ間は、右のボタン（まだ
 * 書いていないタスクでは [作成]、移動の間の行では [移動]）を押すと何が起きるか
 * （書く先と、その先について気をつけること）と、その書き込みが拒まれた理由
 * （`HubForm.sayWrite`）を、foot のボタンの行の上に出す（`CreateLine`）。押せない理由が、押せないボタンの隣に見える。
 * 書いている間に欄が閉じている理由は、欄についての文なのでフォーム全体の文の場所に出す。
 *
 * 閉じる手順（{@link beforeClose}）: ×、Escape、
 * 外側、下へ払う、戻るのどれも、blur を待たずに打ちかけの欄を明示して保存する。
 * 保存できない値（読めない値、日付の規則に反する値）が残れば閉じずに問い
 * （`DraftGuard`）、[直す] にフォーカスを置く。[捨てて閉じる] はその値を
 * 元に戻し、ほかの欄を保存して閉じる。ホストがまだ書いていないもの（`HubHost.draft`）
 * を持つ間は、閉じると失うのはその全部なので、問いはそのものが持つ文
 * （`HubDraft.discardAsk`）の1種類で、[捨てて閉じる] と [戻る] で答える。保存できない値が
 * あるとき、または欄を保存した後に何か入れていれば問う。保存の後にも問うのは、
 * 名前を打って blur せずに閉じたときに、問わずに名前を失わないためである。
 * [戻る] は保存できない欄に、無ければ名前の欄にフォーカスを置く。どちらの
 * ハブでも、[捨てて閉じる] と答えた後はその閉じる手順の中でもう問わない。
 * 最後に、閉じてよいかをホストに聞く（`HubHost.closing`）。フォームの全部が
 * 止まっている間は、何も保存せず、問わずにホストに聞く。行の値の欄だけが
 * 止まっている間は、止まっている欄を保存せず、ホストがまだ書いていないもの
 * （`HubDraft.changed`）を見て問う。[戻る] は、ホストが編集している所に
 * フォーカスを引き受ければ（`HubDraft.keep`）そこに、そうでなければ名前の欄に置く。
 *
 * [キャンセル] から出た問いの捨てる答えは [捨てる] と読む。ハブは閉じないためである。
 * フォームの欄の外（ソースの編集器）で、ホストが持つものを直したときも、問いを
 * 取り下げる（`edited`）。
 *
 * [キャンセル] と右のボタンは、ホストがまだ書いていないものを持つ間だけ出す。
 * フォームは、作るときに形を決めず、ホストが描き直させるたび（`showDraft`）に
 * ホストに聞き直して出し隠しする。欄の打ちかけ、フォーカス、タブ、出ている
 * 問いはそのまま残る。[キャンセル]（{@link cancel}）は、まだ書いていないものを
 * 捨てることを頼む。それがハブの全部であるとき（まだ書いていないタスク）は、×
 * と同じ閉じる手順を通る（`requestClose`）。そうでなければ、閉じるときと同じく
 * 欄を保存し、失うものがあれば捨てるかを問うてから、ハブを開いたまま捨てさせる。
 * 右のボタン（{@link write}）は、読めない打ちかけの欄があれば書かずにその欄へ
 * フォーカスを置く。次に、今の受け継ぐ値で日付の規則が破れた欄があれば、同じく
 * 書かずにその欄へフォーカスを置く。どちらも無ければ打ちかけの欄を保存してから
 * 書かせる。欄の Enter は欄を確定するだけで、書かない。
 *
 * 欄の DOM 構築とコミット/echo の取り込みは欄の部品が持つ: 名前、状態、
 * タグ、スタイル、プロパティは `fields/` 配下、日付は `DateFieldGroup`。
 * 欄の部品は自前の task コピーを持たず、`FieldGroupContext.task`
 * 経由でホストの値を都度読み、値は `put` でホストに渡す。本体は欄の並び、
 * 誤りの出す場所、所見、閉じる手順を持つ。
 */
export class TaskHubForm implements HubForm {
    /**
     * Whether to throw away what a step would lose (values that cannot be
     * saved, what is held not written yet), asked before a close, and before
     * cancel throws away what is held with the hub left open.
     */
    private readonly guard: DraftGuard<'close' | 'discard'>;
    /** The user said to throw away what the close would lose: the close that goes on asks nothing more. */
    private thrownAway = false;
    private actions!: FormActions;
    /** The line above the write, shown while the host holds something not written yet: where it goes, and why a write was refused. */
    private createLine!: CreateLine;
    private fieldCtx: FieldGroupContext;
    private readonly issues: IssueBoard<HubField>;
    /** Where the form says what is of it as a whole: above its tabs, in sight from either. */
    private readonly formSays: HTMLElement;
    private tabs!: TabStrip<HubTab>;
    /** Where the task goes, built at the end of the basic tab; null on a hub that says no place. */
    private place: HubPlace | null = null;
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
        this.guard = new DraftGuard<'close' | 'discard'>({
            loss: () => this.loss(),
            render: () => this.renderActions(),
            asked: () => this.actions.focusKeep(),
            goOn: (after) => {
                this.discardUnsaved();
                if (after === 'discard') {
                    // The hub stays open: the row no longer asks.
                    this.renderActions();
                    this.host.draft()?.discard?.();
                    return;
                }
                this.thrownAway = true;
                this.deps.requestClose?.();
            },
        });
        this.fieldCtx = {
            task: () => this.host.task(),
            isShut: () => this.reach !== null,
            put: (updates) => this.host.put(updates),
            app: deps.app,
            plugin: deps.plugin,
            index: deps.index,
            // Read each time: the host offers none while it moves the row.
            get openSource() { return host.openSource; },
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

        // What is of the form as a whole is said above the tabs (built
        // first, `formSays`); the fields, under them, in the two tabs.
        this.tabs = new TabStrip<HubTab>(c, [
            { id: 'basic', label: t('modal.hub.tabBasic'), icon: 'list' },
            { id: 'detail', label: t('modal.hub.tabDetail'), icon: 'sliders-horizontal' },
        ], { initial: tabOf(this.deps.opensOn ?? 'name') });
        const basic = this.tabs.pane('basic');
        const detail = this.tabs.pane('detail');
        basic.addClass('task-hub__pane--basic');
        detail.addClass('task-hub__pane--detail');

        // --- Name ---
        const nameGroup = basic.createDiv({ cls: 'tv-form__group' });
        this.nameField = new NameField(nameGroup, this.fieldCtx);

        // --- Status + Start / End / Due ---
        const scheduleGroup = basic.createDiv({ cls: 'tv-form__group' });
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

        // --- Where the task goes: the entry's ---
        this.place = this.deps.place?.(basic) ?? null;

        // --- Tags ---
        const tagsGroup = detail.createDiv({ cls: 'tv-form__group' });
        this.tagsField = new TagsFieldGroup(tagsGroup, this.fieldCtx);

        // --- Color / Linestyle / Mask ---
        const styleGroup = detail.createDiv({ cls: 'tv-form__group' });
        this.styleField = new StyleFieldGroup(styleGroup, this.fieldCtx);

        // --- Custom properties ---
        detail.createEl('h4', { text: t('modal.hub.properties'), cls: 'tv-form__section-label' });
        const propsGroup = detail.createDiv({ cls: 'tv-form__group' });
        this.propsField = new PropertiesFieldGroup(propsGroup, this.fieldCtx);

        // The row of buttons, and the question a close puts in it, in the
        // foot, and the line of what the write does above it. Cancel, the
        // write and the line are offered while the host holds something not
        // written yet, as it says each time the row is drawn; the write reads
        // as it says then (`renderActions`).
        const createLine = new CreateLine(this.deps.foot);
        this.createLine = createLine;
        this.actions = new FormActions(this.deps.foot, {
            lead: (row: HTMLElement) => createLine.drawToggle(row),
            cancel: { run: () => this.cancel() },
            actions: [{ label: '', tone: 'cta', run: () => this.write() }],
            ask: {
                discardLabel: t('modal.hub.unsavedDiscard'),
                keepLabel: t('modal.hub.unsavedFix'),
                discard: () => this.guard.discard(),
                keep: () => this.fix(),
            },
        });
        // Typing in a field while asked is fixing it: the question is withdrawn.
        // In the place's fields too, which are of the draft as much.
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
     * Say each finding under the field it is of (the form's above its tabs),
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
        if (this.reach !== null) return;
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
     * answers (`HubHost.closing`). While the whole form is shut nothing is
     * saved and nothing asked: the host answers at once (a create under way
     * is waited for). While only the row's values are, their fields are not
     * saved, and what the host holds is asked of.
     */
    beforeClose(): CloseAnswer {
        const goes = this.reach === 'form' || this.saveForClose();
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
        return this.saveFor('close');
    }

    /** Save every field for the step `after`, as a blur would: whether it goes on, the question put where it would lose anything. */
    private saveFor(after: 'close' | 'discard'): boolean {
        if (!this.guard.request(after)) return false;
        for (const part of this.parts()) part.save();
        return this.guard.request(after);
    }

    // ==================== まだ書いていないもの ====================

    /**
     * Write what the host holds not written yet, as the fields hold it: a
     * value typed that does not read, and then a date the rules across the
     * dates do not let be written as it is inherited now, keeps it from
     * being written, and takes the focus (why is said under it); what is
     * typed and reads is put in first, as a close saves it. A question a
     * close put is withdrawn: writing is acting on what it was about. While
     * the row's values are shut their fields are neither seen nor put in:
     * the host's write is asked as it holds them.
     */
    write(): void {
        const draft = this.host.draft();
        if (!draft?.canWrite()) return;
        this.guard.withdraw();
        const broken = this.reach === null ? this.dateGroup.ruleBroken()[0] : undefined;
        const first = this.unsaved()[0]?.input ?? (broken && this.dateGroup.getInput(broken));
        if (first) {
            this.focusTo({ to: first });
            return;
        }
        for (const part of this.parts()) part.save();
        draft.write();
    }

    /**
     * Put in what is typed in every field, as a close saves it, with no
     * question (`HubForm.putTyped`): a value that cannot be saved keeps all
     * of it, and takes the focus. A question a close put is withdrawn once
     * all is put in: nothing it asked of is left. While the row's values
     * are shut nothing is put in from their fields, and all is.
     */
    putTyped(): boolean {
        const first = this.unsaved()[0];
        if (first) {
            this.focusTo({ to: first.input });
            return false;
        }
        for (const part of this.parts()) part.save();
        this.guard.withdraw();
        return true;
    }

    /**
     * Cancel: throw away what the host holds not written yet. Where that is
     * all the hub is (`HubDraft.discard` null), it is the close the user
     * asks for, as ×: it asks of what it would lose. Otherwise the fields
     * are saved as for a close, and what would be lost asked about (the
     * answer that throws it away goes on to throw it away); then the host
     * throws it away with the hub left open. While the whole form is shut
     * nothing is saved and nothing asked; while only the row's values are,
     * their fields are not saved, and what the host holds is asked of.
     */
    private cancel(): void {
        const draft = this.host.draft();
        if (!draft) return;
        if (!draft.discard) {
            this.deps.requestClose?.();
            return;
        }
        if (this.reach === 'form' || this.saveFor('discard')) draft.discard();
    }

    /**
     * A write ended unwritten (`HubForm.notWritten`): the focus goes where
     * what keeps it from being written is, unless it is in the hub already,
     * where the user goes on. With a write that may be asked again nothing
     * is to be fixed: the write takes it. Without, it is the place:
     * the field of the place's group it answers, its tab chosen first, and
     * with no field there, the basic tab's button, the place shown in its
     * tab. A button raises no on-screen keyboard; a field does.
     */
    notWritten(): void {
        const draft = this.host.draft();
        if (!draft || this.deps.hasFocus?.()) return;
        if (draft.canWrite()) {
            this.actions.focusAct();
            return;
        }
        const field = this.placeFocusOf();
        if (field) this.focusTo(field);
        else this.tabs.focusTab('basic');
    }

    /**
     * The parts of the form a close asks: the name, the dates, the style,
     * the tags and the properties. None while they are shut: a field that
     * takes no edit is neither saved nor asked of.
     */
    private parts(): ClosingPart[] {
        if (this.reach !== null) return [];
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
     * What a close, or cancel, would lose. While the host writes each change
     * as it comes, the values that cannot be saved, by their fields' names:
     * the rest is written as it is saved. While it holds something not
     * written yet, the whole of it, once it was given anything: a value typed
     * that cannot be saved, or a change saved (`HubDraft.changed`). Nothing
     * while the whole form is shut, nor once the user said to throw it away.
     */
    private loss(): Loss | null {
        if (this.reach === 'form' || this.thrownAway) return null;
        const fields = this.unsaved();
        const draft = this.host.draft();
        if (draft) return fields.length > 0 || draft.changed() ? { kind: 'draft' } : null;
        return fields.length > 0 ? { kind: 'unsaved', fields: fields.map(one => one.label) } : null;
    }

    /** Throw away what cannot be saved, as the close said to: those fields show their values again. */
    private discardUnsaved(): void {
        for (const part of this.parts()) part.discardUnsaved();
    }

    /**
     * Keep, as asked: the question is withdrawn, and the first field that
     * cannot be saved takes the focus; with none (what is held kept), where
     * the host takes it (`HubDraft.keep`), else the name, the first of the
     * fields.
     */
    private fix(): void {
        const first = this.unsaved()[0];
        this.guard.keep();
        if (!first && this.host.draft()?.keep?.()) return;
        const to = first?.input ?? this.nameField.fieldElement();
        if (to) this.focusTo({ to });
    }

    /**
     * The buttons in the overlay's foot: the question a close puts, its answer
     * that keeps reading as what it keeps (the value to fix, the task to
     * go on with), and, as the host answers now, cancel, the write and the
     * line above them while it holds something not written yet.
     */
    private renderActions(): void {
        const loss = this.guard.asking;
        const draft = this.host.draft();
        const ask = loss?.kind === 'unsaved'
            ? t('modal.hub.unsavedAsk', { fields: loss.fields.join(t('modal.hub.fieldJoin')) })
            : loss?.kind === 'draft' ? draft?.discardAsk ?? null : null;
        this.createLine.offer(draft !== null);
        this.actions.render({
            busy: draft?.writing() ?? false,
            ctaEnabled: draft?.canWrite() ?? false,
            ask,
            ...(loss?.kind === 'draft' && { keep: t('modal.draft.keep') }),
            // Cancel throws away what is held with the hub left open: its answer does not close.
            ...(this.guard.step === 'discard' && { discard: t('modal.draft.discard') }),
            offered: draft !== null,
            ...(draft && { act: { label: draft.label, busyLabel: draft.busyLabel } }),
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
        this.place?.refresh();
        this.sayFindings();
    }

    sayPut(refusal: string | null): void {
        this.issues.set('put', refusal === null ? [] : [{ at: 'form', tone: 'error', text: refusal }]);
    }

    sayWrite(refusal: string | null): void {
        this.createLine.say('write', refusal === null ? [] : [{ at: 'form', tone: 'error', text: refusal }]);
    }

    sayPlace(issues: readonly FormIssue<never>[]): void {
        this.createLine.say('place', issues);
    }

    showDraft(): void {
        this.renderActions();
    }

    edited(): void {
        this.guard.withdraw();
    }

    /** How far the form takes no edit now, as the host answers (`HubHost.shut`); null while it takes them all. */
    private get reach(): HubShut['reach'] | null {
        return this.host.shut()?.reach ?? null;
    }

    /**
     * The fields enabled or not, and the notice of why not, as the host says.
     * Wholly shut, the form loses nothing to a close (`loss`), so a question
     * a close put is withdrawn: it would ask of fields that take no answer,
     * beside the row of what shut them. With only the row's values shut, a
     * question of values that cannot be saved is withdrawn as well, and one
     * of what the host holds stays: it is still to be answered. The values
     * typed stay, and a close once the fields open again asks of them anew.
     */
    showShut(): void {
        const shut = this.host.shut();
        this.setEnabled(shut?.reach ?? null);
        this.issues.set('shut', shut && shut.why !== null ? [{ at: 'form', tone: 'warning', text: shut.why }] : []);
        if (shut && (shut.reach === 'form' || this.guard.asking?.kind === 'unsaved')) this.guard.withdraw();
    }

    /** Each field enabled unless `reach` shuts it: the place's only with the whole form. */
    private setEnabled(reach: HubShut['reach'] | null): void {
        this.place?.setEnabled(reach !== 'form');
        const enabled = reach === null;
        this.nameField?.setEnabled(enabled);
        this.statusField?.setEnabled(enabled);
        this.dateGroup?.setEnabled(enabled);
        this.styleField?.setEnabled(enabled);
        // tags / props の動的セクションは shut を見て再構築する
        this.tagsField?.setEnabled(enabled);
        this.propsField?.setEnabled(enabled);
    }

    // ==================== focus ====================

    /**
     * Focus the field named, its text met as its kind asks (a property of
     * the hub's menu): once the menu the item was chosen in has gone
     * (`placeFocus`), as a menu shown as a sheet slides away after the item.
     */
    focusField(field: TaskHubFocusField): void {
        const to = this.focusOf(field);
        if (to) this.focusTo(to);
    }

    /**
     * Put the focus on a field of the form, its tab chosen first: a field in
     * a tab not chosen takes no focus.
     */
    private focusTo(focus: FieldFocus<HTMLElement>): void {
        this.tabs.reveal(focus.to);
        placeFocus(focus);
    }

    /**
     * Where the focus goes for the field named, and how its text is met
     * there (`selectionOnFocus`; the place's first field as its group says):
     * what the hub opens on (`initialFocus`) and what the menu focuses
     * alike. Null when the form has no such field.
     */
    focusOf(field: TaskHubFocusField): FieldFocus<HTMLElement> | null {
        if (field === 'place') return this.placeFocusOf();
        const to = this.fieldElement(field);
        return to ? { to, selection: selectionOnFocus(field) } : null;
    }

    private placeFocusOf(): FieldFocus<HTMLElement> | null {
        return this.place?.focus() ?? null;
    }

    /** The element of the field named. */
    fieldElement(field: TaskHubFocusField): HTMLElement | null {
        if (field === 'place') return this.placeFocusOf()?.to ?? null;
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

    /** The hub closed: what it built of the place takes nothing more. */
    dispose(): void {
        this.place?.dispose();
        this.place = null;
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
