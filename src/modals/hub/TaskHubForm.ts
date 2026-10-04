import { DateUtils } from '../../utils/DateUtils';
import { type App } from 'obsidian';
import { t } from '../../i18n';
import { type Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';
import { DateFieldGroup } from '../form/DateFieldGroup';
import { buildStatusOptions, getStatusLabel } from '../../constants/statusOptions';
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
import { SuggestController } from '../../views/customMenus/SuggestController';
import type { PopoverStack } from '../../views/sharedUI/PopoverStack';
import type { DateGroupKey, DateKey } from '../form/DateFieldGroup';
import type { DateTimeFields } from '../TaskDateValidator';
import { logError } from '../../log/log';
import type { FieldGroupContext, HubField } from './fields/FieldGroupContext';
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
    /** suggest（SuggestController）の子ポップオーバーを積む先（パネル所有） */
    stack: PopoverStack;
    /** 継承ラベルクリック等でファイルへ遷移した後に呼ぶ（パネルを閉じる） */
    onNavigate?: () => void;
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
 * フォームが閉じている理由）ごとに置き換える。出す場所は欄の行の下と
 * フォームの末尾である。
 *
 * DOM 構築とコミット/echo ロジックは 3 つのフィールドグループ（tags/style/
 * properties、`fields/` 配下）に分割済み。name/status/date は分割するには
 * 小さすぎる（date は DateFieldGroup が既に持つ）ので本体に残している。
 * フィールドグループは自前の task コピーを持たず、`FieldGroupContext.getTask`
 * 経由で本体の `this.task` を都度読む。
 */
export class TaskHubForm {
    private task: Task;
    /** The writes asked and not yet answered, for {@link drained}. */
    private writing = new Set<Promise<void>>();
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
        this.fieldCtx = {
            getTask: () => this.task,
            isShut: () => this.shut,
            queue: (updates) => this.queue(updates),
            app: deps.app,
            plugin: deps.plugin,
            index: deps.index,
            stack: deps.stack,
            attachSuggest: (input, anchorEl, opts) => this.attachSuggest(input, anchorEl, opts),
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

        const statusSuggest = new SuggestController(this.deps.stack, this.statusPill, '', 'min');
        const openStatusSuggest = () => {
            if (this.shut) return;
            this.deps.stack.closeAll();
            const defs = this.deps.plugin.settings.statusDefinitions;
            statusSuggest.show(
                buildStatusOptions(defs).map(o => o.char),
                (item, char) => {
                    this.renderStatusPreview(item, char);
                    item.createSpan().setText(getStatusLabel(char, defs));
                },
                (char) => {
                    statusSuggest.close();
                    this.commitStatus(char);
                },
            );
        };
        this.statusPill.addEventListener('click', openStatusSuggest);
        // 素の Space は native button click → openStatusSuggest。矢印はハイライトを
        // 動かす。Enter は、ハイライトがあれば確定し、無ければ一覧を開く（素の
        // Enter の click と同じ）。
        this.statusPill.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (statusSuggest.isOpen) statusSuggest.moveHighlight(1);
                else openStatusSuggest();
            } else if (e.key === 'ArrowUp' && statusSuggest.isOpen) {
                e.preventDefault();
                statusSuggest.moveHighlight(-1);
            }
        });
        onFormEnter(this.statusPill, () => {
            const char = statusSuggest.isOpen ? statusSuggest.highlightedValue : null;
            if (char === null) {
                openStatusSuggest();
                return;
            }
            statusSuggest.close();
            this.commitStatus(char);
        });

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

        // What is of the form as a whole is said at its end.
        c.appendChild(this.formSays);

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

    // ==================== suggest 共通（filter-popover と同機構） ====================

    /** status の checkbox プレビュー（filter-popover の pill / suggest item と同型） */
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

    /**
     * text input に SuggestController（候補ドロップダウン）を取り付ける。
     * FilterConditionRenderer.renderSuggestInput と同じイベント設計
     * （input / focus で候補表示、ArrowDown/Up でハイライト移動）。
     *
     * Enter（onFormEnter）は「ハイライトがあれば input.value に反映して閉じる
     * だけ」に留める — 各フィールドの既存 Enter コミットハンドラ（この後に
     * 登録される）が反映後の値を読んで確定する。Escape はパネル側の capture
     * ハンドラが stack を閉じるのでここでは扱わない。
     *
     * フィールドグループへは FieldGroupContext.attachSuggest 経由で公開する。
     */
    private attachSuggest(
        input: HTMLInputElement,
        anchorEl: HTMLElement,
        opts: {
            getCandidates: (query: string) => string[];
            renderItem?: (itemEl: HTMLElement, value: string) => void;
            onPick: (value: string) => void;
        },
    ): void {
        const suggest = new SuggestController(this.deps.stack, anchorEl, '', 'min');
        const render = opts.renderItem
            ?? ((item: HTMLElement, val: string) => { item.createSpan().setText(val); });
        const show = (showAll: boolean) => {
            if (this.shut) return;
            // hub の stack は suggest しか持たない（root popover なし）ので、
            // closeAll = 「他フィールドの suggest を閉じる」。
            this.deps.stack.closeAll();
            suggest.show(opts.getCandidates(showAll ? '' : input.value), render, (val) => {
                suggest.close();
                opts.onPick(val);
            });
        };
        input.addEventListener('input', (e: Event) => {
            if (!(e as InputEvent).isComposing) show(false);
        });
        // IME 確定後に候補を絞り直す唯一の契機。Chromium では確定の 'input'
        // が isComposing=true で飛ぶので（bracketPairing.ts の同じ箇所を
        // 参照）、上の listener はそれを捨てて何も更新しない。WebKit は
        // 'compositionend' が先で確定の 'input' が後に isComposing=false で
        // 来るため、そちらではこの listener が確定前の値で走り、後続の
        // 'input' が確定後の値で絞り直す。どちらの順序でも 1 回は確定後の
        // 値で走り、二重に走っても候補の再描画が 1 回増えるだけである。
        input.addEventListener('compositionend', () => show(false));
        input.addEventListener('focus', () => show(!input.value));
        input.addEventListener('blur', () => suggest.close());
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!suggest.isOpen) show(!input.value);
                else suggest.moveHighlight(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                suggest.moveHighlight(-1);
            }
        });
        onFormEnter(input, () => {
            const hl = suggest.highlightedValue;
            if (hl !== null) input.value = hl;
            suggest.close();
        });
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

    private commitContent(content: string): void {
        if (this.shut) return;
        this.queue(TaskUpdateBuilder.content(this.task, content));
    }

    private commitStatus(value: string): void {
        if (this.shut) return;
        this.queue(TaskUpdateBuilder.status(this.task, value));
        this.renderStatusPill(); // 打った値の model から pill を即時更新
    }

    private commitDates(group: DateGroupKey, f: DateTimeFields): void {
        if (this.shut) return;
        const updates =
            group === 'start' ? TaskUpdateBuilder.dateGroup(this.task, 'start', f.startDate, f.startTime)
            : group === 'end' ? TaskUpdateBuilder.dateGroup(this.task, 'end', f.endDate, f.endTime)
            : TaskUpdateBuilder.due(this.task, f.dueDate, f.dueTime);
        this.queue(updates);
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
     * 書けなかったときの通知は書き込みの層が1回出す。model には打った値が
     * 残るので、ここで写しを読み直す。
     */
    protected queue(updates: Partial<Task> | null): void {
        if (!updates) return;
        this.task = { ...this.task, ...updates };
        const id = this.task.id;
        const write = this.deps.operations.updateTask(id, updates)
            .then((written) => {
                if (written) return;
                const fresh = this.deps.index.getTask(id);
                if (fresh) this.refresh(fresh);
            })
            .catch((e) => logError(`[TaskHubForm] commit failed: ${e instanceof Error ? e.message : String(e)}`))
            .finally(() => { this.writing.delete(write); });
        this.writing.add(write);
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
