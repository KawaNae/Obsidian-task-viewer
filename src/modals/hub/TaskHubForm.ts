import { DateUtils } from '../../utils/DateUtils';
import { Notice, type App } from 'obsidian';
import { t } from '../../i18n';
import { type Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';
import { DateFieldGroup } from '../form/DateFieldGroup';
import { addStatusItems, getStatusLabel } from '../../constants/statusOptions';
import { TaskNameSuggest } from '../../suggest/TaskNameSuggest';
import { createFormRow } from '../form/formRow';
import { PROPERTY_ICONS } from '../../constants/propertyIcons';
import { attachBracketPairing } from '../form/bracketPairing';
import { onFormEnter } from '../form/formEnter';
import { bindField, type BoundField } from '../form/bindField';
import { IssueBoard, readIssue, type IssueSlot } from '../form/FormIssue';
import { TaskContentInput } from '../../services/parsing/tv-inline/TaskContentInput';
import { TaskUpdateBuilder } from '../form/TaskUpdateBuilder';
import { CascadeSource, type CascadeSourceKind } from './CascadeSource';
import { openFile } from '../../utils/NavigationUtils';
import type { DateGroupKey, DateKey } from '../form/DateFieldGroup';
import type { DateTimeFields } from '../TaskDateValidator';
import { logError } from '../../log/log';
import { refusalNotice } from '../../services/core/RefusalClause';
import { refusalText, type WriteAnswer } from '../../services/operations/WriteAnswer';
import type { CloseAnswer } from '../../views/sharedUI/CloseGate';
import { DraftGuard, type Loss } from '../form/DraftGuard';
import { FormActions } from '../form/FormActions';
import type { ClosingPart, FieldGroupContext, HubField, UnsavedField } from './fields/FieldGroupContext';
import { TagsFieldGroup } from './fields/TagsFieldGroup';
import { StyleFieldGroup } from './fields/StyleFieldGroup';
import { PropertiesFieldGroup } from './fields/PropertiesFieldGroup';

export type TaskHubFocusField =
    | 'name' | 'status' | 'start' | 'end' | 'due'
    | 'tags' | 'color' | 'linestyle' | 'mask' | 'properties'
    | `property:${string}`;

export interface TaskHubFormDeps {
    app: App;
    plugin: PluginContext;
    index: IndexReads;
    operations: Operations;
    /** 継承ラベルクリック等でファイルへ遷移した後に呼ぶ（パネルを閉じる） */
    onNavigate?: () => void;
    /** Ask the hub to close, as the user would (`OverlayShell.requestClose`): what a close the user said to go on with does. */
    requestClose?: () => void;
}

/**
 * タスクハブのプロパティ編集フォーム。
 *
 * 保存モデル: フィールド確定（blur / Enter / picker・clear / 選択）ごとに
 * 差分だけを updateTask する即時コミット。Save ボタンは持たない。
 * コミットは promise チェーンで直列化し、vault.process の競合を防ぐ。
 *
 * 欄は `bindField` で値に結ぶ。打った値は欄の codec で読み、読めない値は
 * 欄の下に理由を出して保存しない。外部変更（自分の書き込みの echo を含む）
 * は refresh(fresh) で `BoundField.set` を通して取り込み、イベントを投げない。
 * 打ちかけの字がある欄と IME の変換中の欄は取り込まない — 欄の字が、欄に
 * 最後に入れた値の字と違うかで見分ける。フラグや世代カウンタは持たない。
 *
 * 誤りと注意は `IssueBoard` が持ち、出どころ（欄の名前、日付の規則、
 * フォームが閉じている理由、書き込みの拒否）ごとに置き換える。出す場所は
 * 欄の行の下とフォームの末尾である。
 *
 * 書き込みの拒否（I#9、論点3）: 書き込みは通知を出さない書き方で頼み
 * （`tellRefusal: false`）、拒まれた理由をフォームの末尾に1回だけ出す。拒まれた
 * 欄は打った値のまま残り（`bindField`）、もう一度確定すれば新しい版へ書く。
 * ハブが閉じた後に届いた拒否は通知で言う。
 *
 * 閉じる手順（{@link beforeClose}、ハブを閉じるときの保存の決定）: ×、Escape、
 * 外側、下へ払う、戻るのどれも、blur を待たずに打ちかけの欄を明示して保存する。
 * 保存できない値（読めない値、日付の規則に反する値）が残れば閉じずに問い
 * （`DraftGuard`、論点G）、[直す] にフォーカスを置く。[捨てて閉じる] はその値を
 * 元に戻し、ほかの欄を保存して閉じる。書き込みが途中なら答えを待ち、拒まれたら
 * 開いたまま理由を出す。
 *
 * DOM 構築とコミット/echo ロジックは 3 つのフィールドグループ（tags/style/
 * properties、`fields/` 配下）に分割済み。name/status/date は分割するには
 * 小さすぎる（date は DateFieldGroup が既に持つ）ので本体に残している。
 * フィールドグループは自前の task コピーを持たず、`FieldGroupContext.getTask`
 * 経由で本体の `this.task` を都度読む。
 */
export class TaskHubForm {
    private task: Task;
    /** The writes asked and not yet answered, each to whether it was written, for {@link drained} and the close. */
    private writing = new Set<Promise<boolean>>();
    /** The hub closed: a refusal that comes after is told by a notice. */
    private closed = false;
    /** Whether to throw away the values a close cannot save, asked before it closes. */
    private readonly guard: DraftGuard<'close'>;
    private actions!: FormActions;
    /** The row is gone from the index: nothing to write to. */
    private missing = false;
    /** The source mode holds the row: its draft is the one way to write it until it closes. */
    private sourceOpen = false;
    private fieldCtx: FieldGroupContext;
    private readonly issues: IssueBoard<HubField>;
    /** Where the form says what is of it as a whole: at its end. */
    private readonly formSays: HTMLElement;

    private nameInput: HTMLInputElement;
    private nameSays: HTMLElement;
    private nameField: BoundField<string>;
    private statusPill: HTMLButtonElement;
    private dateGroup: DateFieldGroup;
    private tagsField: TagsFieldGroup;
    private styleField: StyleFieldGroup;
    private propsField: PropertiesFieldGroup;

    constructor(
        private container: HTMLElement,
        task: Task,
        private deps: TaskHubFormDeps,
    ) {
        this.task = task;
        this.formSays = container.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<HubField>({
            field: (at) => this.slotOf(at),
            form: this.formSays,
        });
        this.guard = new DraftGuard<'close'>({
            loss: () => this.loss(),
            render: () => this.renderAsk(),
            asked: () => this.actions.focusKeep(),
            goOn: () => {
                this.discardUnsaved();
                this.deps.requestClose?.();
            },
        });
        this.fieldCtx = {
            getTask: () => this.task,
            isShut: () => this.shut,
            queue: (updates) => this.queue(updates),
            app: deps.app,
            plugin: deps.plugin,
            index: deps.index,
            sourceLabel: (source) => this.sourceLabel(source),
            jumpToFile: () => this.jumpToFile(),
            issues: this.issues,
        };
        this.render();
    }

    // ==================== DOM 構築 ====================

    private render(): void {
        const c = this.container;
        c.addClass('tv-form'); // _form.css の行文法（ラベル列幅など）の適用ルート

        // --- Name ---
        const nameGroup = c.createDiv({ cls: 'tv-form__group' });
        const nameSection = nameGroup.createDiv({ cls: 'tv-form__name-section' });
        nameSection.createEl('label', { text: t('modal.taskName') });
        this.nameInput = nameSection.createEl('input', {
            type: 'text',
            placeholder: t('modal.taskName'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        this.nameInput.value = this.task.content ?? '';
        this.nameSays = nameSection.createDiv({ cls: 'tv-form__says' });
        const nameSuggest = new TaskNameSuggest(this.deps.app, this.nameInput);
        attachBracketPairing(this.nameInput, () => { /* 値取り込みは commit 時 */ });
        this.nameField = bindField(this.nameInput, {
            codec: TaskContentInput,
            current: () => this.task.content ?? '',
            commit: (content) => this.commitContent(content),
            issues: (issue) => this.issues.set('name', readIssue('name', issue)),
            // An Enter that picks from the name's list is the list's.
            takesEnter: () => nameSuggest.listShown,
        });

        // --- Status + Dates ---
        const scheduleGroup = c.createDiv({ cls: 'tv-form__group' });
        const { row: statusRow } = createFormRow(scheduleGroup, t('modal.hub.status'), { icon: PROPERTY_ICONS.status });
        this.statusPill = statusRow.createEl('button', {
            cls: 'tv-ctrl__pill task-hub__status-pill',
            attr: { type: 'button' },
        });
        this.renderStatusPill();

        // The statuses are the card menu's (Obsidian's Menu), under the button.
        const openStatusMenu = () => {
            if (this.shut) return;
            this.deps.plugin.menuPresenter.present(
                (menu) => addStatusItems(menu, this.deps.plugin.settings.statusDefinitions, this.task.statusChar, (char) => this.commitStatus(char)),
                { kind: 'belowRect', rect: this.statusPill.getBoundingClientRect() },
            );
        };
        // A click, Space or the form's Enter opens the menu, and so does the
        // down arrow; the menu takes the keys while it is open.
        this.statusPill.addEventListener('click', openStatusMenu);
        this.statusPill.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'ArrowDown') return;
            e.preventDefault();
            openStatusMenu();
        });
        onFormEnter(this.statusPill, openStatusMenu);

        // --- Start / End / Due ---
        this.dateGroup = new DateFieldGroup(scheduleGroup, {
            labels: { start: t('modal.start'), end: t('modal.end'), due: t('modal.due') },
            icons: { start: PROPERTY_ICONS.start, end: PROPERTY_ICONS.end, due: PROPERTY_ICONS.due },
            initial: dateFieldsOf(this.task),
            current: () => dateFieldsOf(this.task),
            buildOverlayTask: (f) => ({
                ...this.task,
                startDate: f.startDate || undefined,
                startTime: f.startTime || undefined,
                endDate: f.endDate || undefined,
                endTime: f.endTime || undefined,
                due: DateUtils.joinDateTime(f.dueDate, f.dueTime),
            }),
            getStartHour: () => this.deps.plugin.settings.startHour,
            taskLookup: (id) => this.deps.index.getTask(id),
            getValidationCtx: () => ({
                hasImplicitStartDate: !!this.task.cascadeContext?.startDate,
                implicitStartDate: this.task.cascadeContext?.startDate,
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
            actions: [],
            ask: {
                discardLabel: t('modal.hub.unsavedDiscard'),
                keepLabel: t('modal.hub.unsavedFix'),
                discard: () => this.guard.discard(),
                keep: () => this.fix(),
            },
        });
        // Typing in a field while asked is fixing it: the question is withdrawn.
        c.addEventListener('input', () => { this.guard.withdraw(); });

        this.dateGroup.updatePlaceholders();
    }

    /** Where the field `at` says its issues now; null for a row that is not there. */
    private slotOf(at: HubField): IssueSlot | null {
        if (at === 'name') return { input: this.nameInput, message: this.nameSays };
        if (at === 'tags') return this.tagsField?.slot() ?? null;
        if (at === 'color' || at === 'linestyle' || at === 'mask') return this.styleField?.slot(at) ?? null;
        if (at === 'propKey' || at.startsWith('prop:')) return this.propsField?.slot(at) ?? null;
        return this.dateGroup?.slot(at as DateKey) ?? null;
    }

    /** status の checkbox プレビュー（filter-popover の pill と同型） */
    private renderStatusPreview(container: HTMLElement, char: string): void {
        const checkbox = container.createEl('input', { cls: 'task-list-item-checkbox tv-ctrl__status-checkbox' });
        checkbox.type = 'checkbox';
        checkbox.checked = char !== ' ';
        checkbox.readOnly = true;
        checkbox.tabIndex = -1;
        if (char !== ' ') checkbox.dataset.task = char;
    }

    private renderStatusPill(): void {
        this.statusPill.empty();
        this.renderStatusPreview(this.statusPill, this.task.statusChar);
        this.statusPill.createSpan().setText(
            getStatusLabel(this.task.statusChar, this.deps.plugin.settings.statusDefinitions),
        );
    }

    // ==================== 共通小物 ====================

    private sourceLabel(source: CascadeSourceKind): string {
        return source === 'file' ? t('modal.hub.inheritedFromFile') : t('modal.hub.inheritedFromSection');
    }

    private jumpToFile(): void {
        void openFile(this.deps.app, this.task.file, this.deps.plugin.settings.reuseExistingTab);
        this.deps.onNavigate?.();
    }

    // ==================== コミット ====================

    private commitContent(content: string): Promise<boolean> | void {
        if (this.shut) return;
        return this.queue(TaskUpdateBuilder.content(this.task, content));
    }

    private commitStatus(value: string): void {
        if (this.shut) return;
        void this.queue(TaskUpdateBuilder.status(this.task, value));
        this.renderStatusPill(); // 打った値の model から pill を即時更新
    }

    private commitDates(group: DateGroupKey, f: DateTimeFields): Promise<boolean> | void {
        if (this.shut) return;
        const updates =
            group === 'start' ? TaskUpdateBuilder.dateGroup(this.task, 'start', f.startDate, f.startTime)
            : group === 'end' ? TaskUpdateBuilder.dateGroup(this.task, 'end', f.endDate, f.endTime)
            : TaskUpdateBuilder.due(this.task, f.dueDate, f.dueTime);
        return this.queue(updates);
    }

    /**
     * 編集を書き込みに出す。
     *
     * フォームの model（`this.task`）は入力欄に打った値そのもので、索引の
     * 写しではない。echo（refresh）が来る前に次のコミットが組み立てられても
     * 打った値から組み立てるよう、model へ先に重ねる。echo は refresh(fresh)
     * が正として上書きする。
     *
     * 続けて出した書き込みの順は操作の層が守る: 同じ行の書き込みは頼んだ
     * 順に並び、2本目は1本目が残した読みから計画される（`onRow`）。
     * 書けなかったときは {@link answered} が理由を言い、model を写しに戻す。
     *
     * @returns 書けたか（拒まれた欄は打った値を残す: `bindField`）
     */
    protected queue(updates: Partial<Task> | null): Promise<boolean> {
        if (!updates) return Promise.resolve(true);
        this.task = { ...this.task, ...updates };
        const id = this.task.id;
        const write: Promise<boolean> = this.deps.operations.updateTask(id, updates, { tellRefusal: false })
            .then((answer) => {
                this.answered(id, answer);
                return answer.written;
            })
            .catch((e) => {
                logError(`[TaskHubForm] commit failed: ${e instanceof Error ? e.message : String(e)}`);
                return false;
            })
            .finally(() => { this.writing.delete(write); });
        this.writing.add(write);
        return write;
    }

    /**
     * A write's answer. Written, the last refusal said is taken back. Refused,
     * why is said at the form's end once (no notice: the write was asked with
     * `tellRefusal: false`), and the model goes back to the index's copy: the
     * fields refused keep what was typed, and are written again from the new
     * reading when committed again. Once the hub has closed, a refusal is told
     * by a notice, as any write's is.
     */
    private answered(id: string, answer: WriteAnswer): void {
        if (this.closed) {
            if (!answer.written && answer.refused) new Notice(refusalNotice(answer.refused));
            return;
        }
        if (answer.written) {
            this.issues.set('write', []);
            return;
        }
        this.issues.set('write', [{ at: 'form', tone: 'error', text: refusalText(answer.refused) }]);
        const fresh = this.deps.index.getTask(id);
        if (fresh) this.refresh(fresh);
    }

    // ==================== 閉じる手順 ====================

    /**
     * Whether the hub may close now (the panel asks it after the source mode):
     * every field typed in and not committed is saved, as a blur would, with no
     * blur waited for. A value that cannot be saved keeps the hub open and asks
     * whether to throw it away (`'stay'`). A write under way is waited for: all
     * written, the hub closes; one refused, it stays open with why at the
     * form's end. Nothing is saved while the form is shut (the source holds
     * the row, or the row is gone).
     */
    beforeClose(): CloseAnswer {
        if (this.shut) return 'close';
        if (!this.guard.request('close')) return 'stay';
        for (const part of this.parts()) part.save();
        if (this.writing.size === 0) return 'close';
        return this.settled().then(written => (written ? 'close' : 'stay'));
    }

    /** Resolves once every write asked so far is answered: whether all of them were written. */
    private async settled(): Promise<boolean> {
        let written = true;
        while (this.writing.size > 0) {
            const answers = await Promise.all(this.writing);
            if (answers.includes(false)) written = false;
        }
        return written;
    }

    /** The parts of the form a close asks: the name, the dates, the style, the tags and the properties. */
    private parts(): ClosingPart[] {
        const name: ClosingPart = {
            unsaved: () => (this.nameField.pending()?.ok === false ? [{ label: t('modal.taskName'), input: this.nameInput }] : []),
            discardUnsaved: () => { if (this.nameField.pending()?.ok === false) this.nameField.discard(); },
            save: () => { if (this.nameField.pending()?.ok) this.nameField.commit(); },
        };
        const dates: ClosingPart = {
            unsaved: () => this.dateGroup.unsaved().map(key => ({ label: this.dateGroup.labelOf(key), input: this.dateGroup.getInput(key) })),
            discardUnsaved: () => this.dateGroup.discardUnsaved(),
            save: () => this.dateGroup.save(),
        };
        return [name, dates, this.styleField, this.tagsField, this.propsField];
    }

    private unsaved(): UnsavedField[] {
        return this.parts().flatMap(part => part.unsaved());
    }

    /** What a close would lose: the values that cannot be saved, by their fields' names. */
    private loss(): Loss | null {
        if (this.shut) return null;
        const fields = this.unsaved();
        return fields.length === 0 ? null : { kind: 'unsaved', fields: fields.map(one => one.label) };
    }

    /** Throw away what cannot be saved, as the close said to: those fields show their values again. */
    private discardUnsaved(): void {
        for (const part of this.parts()) part.discardUnsaved();
    }

    /** Fix, as asked: the question is withdrawn, and the first field that cannot be saved takes the focus. */
    private fix(): void {
        const first = this.unsaved()[0];
        this.guard.keep();
        first?.input.focus();
    }

    /** The question a close puts, drawn at the form's end. */
    private renderAsk(): void {
        const loss = this.guard.asking;
        const ask = loss?.kind === 'unsaved'
            ? t('modal.hub.unsavedAsk', { fields: loss.fields.join(t('modal.hub.fieldJoin')) })
            : null;
        this.actions.render({ busy: false, ask });
    }

    /** The hub closed: a refusal that comes after is told by a notice. */
    dispose(): void {
        this.closed = true;
    }

    // ==================== 外部変更の取り込み ====================

    /**
     * index の変更（自書き込みの echo / 外部編集）をフォームへ反映する。
     * focus 中・IME composition 中のフィールドはスキップ。
     */
    refresh(fresh: Task): void {
        this.task = fresh;
        if (this.missing) {
            // missing からの復帰時のみ全体を再有効化する。毎 echo で
            // setEnabled(true) を通すと force rebuild が focus 中の入力を
            // 破壊し、focus ガードの意味がなくなる。
            this.missing = false;
            this.showShut();
        }

        this.nameField.set(fresh.content ?? '');
        this.renderStatusPill();
        this.dateGroup.set(dateFieldsOf(fresh));
        this.styleField.refresh();
        this.tagsField.refresh();
        this.propsField.refresh();
    }

    /** タスクが index から消えた（削除 / id 変化）ときの縮退表示 */
    setMissing(): void {
        if (this.missing) return;
        this.missing = true;
        this.showShut();
    }

    /**
     * The source mode opened or closed on the row. While it is open the form
     * takes no edit: two ways of writing one row would have one of them
     * refused (`changed`), and the draft is the user's work.
     */
    setSourceOpen(open: boolean): void {
        if (this.sourceOpen === open) return;
        this.sourceOpen = open;
        this.showShut();
    }

    /** Resolves once every write queued so far is done: the source opens on what they left. */
    async drained(): Promise<void> {
        while (this.writing.size > 0) await Promise.all(this.writing);
    }

    /** Whether the form takes no edit, and why: the source open, or the row gone. */
    private get shut(): boolean {
        return this.missing || this.sourceOpen;
    }

    /** The fields enabled or not, and the notice of why not, as the two states say. */
    private showShut(): void {
        this.setEnabled(!this.shut);
        const notice = this.sourceOpen ? t('modal.hub.source.formShut') : this.missing ? t('modal.hub.taskMissing') : null;
        this.issues.set('shut', notice ? [{ at: 'form', tone: 'warning', text: notice }] : []);
    }

    private setEnabled(enabled: boolean): void {
        const inputs = [this.nameInput];
        for (const i of inputs) { if (i) i.disabled = !enabled; }
        this.dateGroup?.setEnabled(enabled);
        if (this.statusPill) {
            this.statusPill.disabled = !enabled;
            this.statusPill.toggleClass('is-disabled', !enabled);
        }
        this.styleField?.setEnabled(enabled);
        // tags / props の動的セクションは shut を見て再構築する
        this.tagsField?.setEnabled(enabled);
        this.propsField?.setEnabled(enabled);
    }

    // ==================== focus ====================

    /** Focus the field named, its text selected (a property of the hub's menu). */
    focusField(field: TaskHubFocusField): void {
        const target = this.fieldElement(field);
        target?.focus();
        if (target instanceof HTMLInputElement) target.select();
    }

    /** The element of the field named: what the hub opens on (`initialFocus`) and the menu focuses. */
    fieldElement(field: TaskHubFocusField): HTMLElement | null {
        if (field.startsWith('property:')) {
            return this.propsField.fieldElement(field.slice('property:'.length));
        }
        switch (field) {
            case 'name': return this.nameInput;
            case 'status': return this.statusPill ?? null;
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
