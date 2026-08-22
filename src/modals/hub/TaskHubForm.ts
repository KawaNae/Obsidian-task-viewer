import { type App } from 'obsidian';
import { t } from '../../i18n';
import { type Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import { DateFieldGroup } from '../form/DateFieldGroup';
import { buildStatusOptions, getStatusLabel } from '../../constants/statusOptions';
import { TaskNameSuggest } from '../../suggest/TaskNameSuggest';
import { createFormRow } from '../form/formRow';
import { PROPERTY_ICONS } from '../../constants/propertyIcons';
import { attachBracketPairing, type BracketPairingHandle } from '../form/bracketPairing';
import { TaskUpdateBuilder } from '../form/TaskUpdateBuilder';
import { CascadeSource, type CascadeSourceKind } from './CascadeSource';
import { openFileInExistingOrNewTab } from '../../utils/NavigationUtils';
import { SuggestController } from '../../views/customMenus/SuggestController';
import type { PopoverStack } from '../../views/sharedUI/PopoverStack';
import type { DateGroupKey } from '../form/DateFieldGroup';
import { logError } from '../../log/log';
import type { FieldGroupContext } from './fields/FieldGroupContext';
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
    readService: TaskReadService;
    writeService: TaskWriteService;
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
 * echo 防御: 外部変更（自分の書き込みの echo を含む）は refresh(fresh) で
 * 取り込むが、「focus 中の入力」と「IME composition 中」のフィールドは
 * スキップする。フラグや世代カウンタは持たない — focus 状態だけで
 * 自書き込み echo と外部編集の合流が同じ規則で正しく処理される。
 *
 * DOM 構築とコミット/echo ロジックは 3 つのフィールドグループ（tags/style/
 * properties、`fields/` 配下）に分割済み。name/status/date は分割するには
 * 小さすぎる（date は DateFieldGroup が既に持つ）ので本体に残している。
 * フィールドグループは自前の task コピーを持たず、`FieldGroupContext.getTask`
 * 経由で本体の `this.task` を都度読む。
 */
export class TaskHubForm {
    private task: Task;
    private commitChain: Promise<void> = Promise.resolve();
    private missing = false;
    private refreshing = false;
    private fieldCtx: FieldGroupContext;

    private nameInput: HTMLInputElement;
    private pairing: BracketPairingHandle;
    private statusPill: HTMLButtonElement;
    private dateGroup: DateFieldGroup;
    private tagsField: TagsFieldGroup;
    private styleField: StyleFieldGroup;
    private propsField: PropertiesFieldGroup;
    private errorEl: HTMLElement;
    private noticeEl: HTMLElement;

    constructor(
        private container: HTMLElement,
        task: Task,
        private deps: TaskHubFormDeps,
    ) {
        this.task = task;
        this.fieldCtx = {
            getTask: () => this.task,
            isMissing: () => this.missing,
            queue: (updates) => this.queue(updates),
            app: deps.app,
            plugin: deps.plugin,
            readService: deps.readService,
            stack: deps.stack,
            attachSuggest: (input, anchorEl, opts) => this.attachSuggest(input, anchorEl, opts),
            sourceLabel: (source) => this.sourceLabel(source),
            jumpToFile: () => this.jumpToFile(),
            showFormError: (message) => this.showFormError(message),
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
        new TaskNameSuggest(this.deps.app, this.nameInput);
        this.pairing = attachBracketPairing(this.nameInput, () => { /* 値取り込みは commit 時 */ });
        this.nameInput.addEventListener('blur', () => this.commitContent());
        this.nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing && !this.pairing.isComposing()) {
                this.commitContent();
            }
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
            if (this.missing) return;
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
        // 素の Enter / Space は native button click → openStatusSuggest。
        // ここではハイライト操作（矢印移動・確定）だけを扱う。
        this.statusPill.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (statusSuggest.isOpen) statusSuggest.moveHighlight(1);
                else openStatusSuggest();
            } else if (e.key === 'ArrowUp' && statusSuggest.isOpen) {
                e.preventDefault();
                statusSuggest.moveHighlight(-1);
            } else if (e.key === 'Enter' && statusSuggest.isOpen && statusSuggest.highlightedValue !== null) {
                e.preventDefault(); // native click（suggest 再オープン）を抑止して確定
                const char = statusSuggest.highlightedValue;
                statusSuggest.close();
                this.commitStatus(char);
            }
        });

        // --- Start / End / Due ---
        const dl = DateFieldGroup.splitDue(this.task.due);
        this.dateGroup = new DateFieldGroup(scheduleGroup, {
            labels: { start: t('modal.start'), end: t('modal.end'), due: t('modal.due') },
            icons: { start: PROPERTY_ICONS.start, end: PROPERTY_ICONS.end, due: PROPERTY_ICONS.due },
            initial: {
                startDate: this.task.startDate || '',
                startTime: this.task.startTime || '',
                endDate: this.task.endDate || '',
                endTime: this.task.endTime || '',
                dueDate: dl.date || '',
                dueTime: dl.time || '',
            },
            buildOverlayTask: (f) => ({
                ...this.task,
                startDate: f.startDate || undefined,
                startTime: f.startTime || undefined,
                endDate: f.endDate || undefined,
                endTime: f.endTime || undefined,
                due: f.dueDate ? (f.dueTime ? `${f.dueDate}T${f.dueTime}` : f.dueDate) : undefined,
            }),
            getStartHour: () => this.deps.plugin.settings.startHour,
            taskLookup: (id) => this.deps.readService.getTask(id),
            getValidationCtx: () => ({
                hasImplicitStartDate: !!this.task.cascadeContext?.startDate,
                implicitStartDate: this.task.cascadeContext?.startDate,
            }),
            isSuspended: () => this.refreshing,
            onCommit: (group) => this.commitDates(group),
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

        // --- Error / notice ---
        this.errorEl = c.createDiv({ cls: 'tv-form__error' });
        this.errorEl.style.display = 'none';
        this.dateGroup.bindErrorEl(this.errorEl);
        this.noticeEl = c.createDiv({ cls: 'tv-form__warning' });
        this.noticeEl.style.display = 'none';

        this.dateGroup.updatePlaceholders();
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
     * Enter は「ハイライトがあれば input.value に反映して閉じるだけ」に
     * 留める — 各フィールドの既存 Enter コミットハンドラ（この後に登録
     * される）が反映後の値を読んで確定する。Escape はパネル側の capture
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
            if (this.missing) return;
            // hub の stack は suggest しか持たない（root popover なし）ので、
            // closeAll = 「他フィールドの suggest を閉じる」。
            this.deps.stack.closeAll();
            suggest.show(opts.getCandidates(showAll ? '' : input.value), render, (val) => {
                suggest.close();
                opts.onPick(val);
            });
        };
        input.addEventListener('input', (e: Event) => {
            if (!(e as InputEvent).isComposing && !this.refreshing) show(false);
        });
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
            } else if (e.key === 'Enter' && !e.isComposing) {
                const hl = suggest.highlightedValue;
                if (hl !== null) input.value = hl;
                suggest.close();
            }
        });
    }

    // ==================== 共通小物 ====================

    private sourceLabel(source: CascadeSourceKind): string {
        return source === 'file' ? t('modal.hub.inheritedFromFile') : t('modal.hub.inheritedFromSection');
    }

    private jumpToFile(): void {
        if (this.deps.plugin.settings.reuseExistingTab) {
            openFileInExistingOrNewTab(this.deps.app, this.task.file);
        } else {
            void this.deps.app.workspace.openLinkText(this.task.file, '', true);
        }
        this.deps.onNavigate?.();
    }

    private showFormError(message: string): void {
        this.errorEl.empty();
        this.errorEl.setText(message);
        this.errorEl.style.display = 'block';
    }

    // ==================== コミット ====================

    private commitContent(): void {
        if (this.missing) return;
        this.queue(TaskUpdateBuilder.content(this.task, this.nameInput.value));
    }

    private commitStatus(value: string): void {
        if (this.missing) return;
        this.queue(TaskUpdateBuilder.status(this.task, value));
        this.renderStatusPill(); // 楽観 model から pill を即時更新
    }

    private commitDates(group: DateGroupKey): void {
        if (this.missing) return;
        if (!this.dateGroup.validate()) return;
        const f = this.dateGroup.collect();
        const updates =
            group === 'start' ? TaskUpdateBuilder.dateGroup(this.task, 'start', f.startDate, f.startTime)
            : group === 'end' ? TaskUpdateBuilder.dateGroup(this.task, 'end', f.endDate, f.endTime)
            : TaskUpdateBuilder.due(this.task, f.dueDate, f.dueTime);
        this.queue(updates);
    }

    /** コミットを直列化して発行する（vault.process の競合防止） */
    protected queue(updates: Partial<Task> | null): void {
        if (!updates) return;
        // 楽観更新: echo（refresh）到着前に次のコミットが組み立てられても
        // 陳腐な base を掴まないよう、ローカル model へ先に反映する。
        // echo は refresh(fresh) が正として上書きする。
        this.task = { ...this.task, ...updates };
        const id = this.task.id;
        this.commitChain = this.commitChain
            .then(() => this.deps.writeService.updateTask(id, updates))
            .catch((e) => logError(`[TaskHubForm] commit failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    /**
     * ファイル rename に伴う id / path の付け替え（パネルの rename 追従から
     * 呼ばれる）。以降の commit は新 id 宛てに発行される。rename 直前に
     * enqueue 済みの commit は旧 id のまま失敗し得る（ms 窓、queue の
     * catch がログする既存挙動）。
     */
    handleFileRename(newId: string, newPath: string): void {
        this.task = { ...this.task, id: newId, file: newPath };
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
            this.noticeEl.style.display = 'none';
            this.setEnabled(true);
        }

        this.refreshing = true;
        try {
            this.setInputValue(this.nameInput, fresh.content ?? '', this.pairing.isComposing());
            this.renderStatusPill();
            const dl = DateFieldGroup.splitDue(fresh.due);
            this.dateGroup.setInputValue(this.dateGroup.getInput('startDate'), fresh.startDate ?? '');
            this.dateGroup.setInputValue(this.dateGroup.getInput('startTime'), fresh.startTime ?? '');
            this.dateGroup.setInputValue(this.dateGroup.getInput('endDate'), fresh.endDate ?? '');
            this.dateGroup.setInputValue(this.dateGroup.getInput('endTime'), fresh.endTime ?? '');
            this.dateGroup.setInputValue(this.dateGroup.getInput('dueDate'), dl.date ?? '');
            this.dateGroup.setInputValue(this.dateGroup.getInput('dueTime'), dl.time ?? '');
            this.dateGroup.updatePlaceholders();
            this.styleField.refresh(fresh, (input, value) => this.setInputValue(input, value));
            this.tagsField.refresh();
            this.propsField.refresh();
        } finally {
            this.refreshing = false;
        }
    }

    private setInputValue(input: HTMLInputElement, value: string, composing = false): void {
        if (document.activeElement === input || composing) return;
        if (input.value === value) return;
        input.value = value;
        // clear ボタン表示等の widget 内部状態を同期させる
        // （refreshing ガードによりコミットは発火しない）
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /** タスクが index から消えた（削除 / id 変化）ときの縮退表示 */
    setMissing(): void {
        this.missing = true;
        this.setEnabled(false);
        this.noticeEl.setText(t('modal.hub.taskMissing'));
        this.noticeEl.style.display = 'block';
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
        // tags / props の動的セクションは missing フラグを見て再構築する
        this.tagsField?.setEnabled(enabled);
        this.propsField?.setEnabled(enabled);
    }

    // ==================== focus ====================

    focusField(field: TaskHubFocusField): void {
        const target = this.resolveFocusTarget(field);
        target?.focus();
        if (target instanceof HTMLInputElement) target.select();
    }

    protected resolveFocusTarget(field: TaskHubFocusField): HTMLElement | null {
        if (field.startsWith('property:')) {
            const key = field.slice('property:'.length);
            this.propsField.focus(key);
            return null;
        }
        switch (field) {
            case 'name': return this.nameInput;
            case 'status': return this.statusPill ?? null;
            case 'start': return this.dateGroup?.getInput('startDate');
            case 'end': return this.dateGroup?.getInput('endDate');
            case 'due': return this.dateGroup?.getInput('dueDate');
            case 'tags': this.tagsField.focus(); return null;
            case 'color': return this.styleField?.getInput('color') ?? null;
            case 'linestyle': return this.styleField?.getInput('linestyle') ?? null;
            case 'mask': return this.styleField?.getInput('mask') ?? null;
            case 'properties': this.propsField.focus(); return null;
            default: return null;
        }
    }

}
