import { App, setIcon } from 'obsidian';
import { t } from '../../i18n';
import { isTvFile, type PropertyValue, type Task } from '../../types';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import { DateFieldGroup } from '../form/DateFieldGroup';
import { buildStatusOptions, getStatusLabel } from '../../constants/statusOptions';
import { VALID_LINE_STYLES } from '../../constants/style';
import { TaskNameSuggest } from '../../suggest/TaskNameSuggest';
import { filterColors, renderColorSuggestion } from '../../suggest/color/colorUtils';
import { filterLineStyles, renderLineStyleSuggestion } from '../../suggest/line/lineStyleUtils';
import { createFormRow } from '../form/formRow';
import { attachBracketPairing, BracketPairingHandle } from '../form/bracketPairing';
import { TaskUpdateBuilder } from '../form/TaskUpdateBuilder';
import { CascadeSource, type CascadeSourceKind } from './CascadeSource';
import { getEffectiveTags, getEffectiveProperties } from '../../services/data/EffectiveProperties';
import { TagExtractor } from '../../services/parsing/utils/TagExtractor';
import { ChildLineClassifier } from '../../services/parsing/utils/ChildLineClassifier';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { openFileInExistingOrNewTab } from '../../views/sharedLogic/NavigationUtils';
import { SuggestController } from '../../views/customMenus/SuggestController';
import type { PopoverStack } from '../../views/sharedUI/PopoverStack';
import type { DateGroupKey } from '../form/DateFieldGroup';
import { logError } from '../../log/log';

export type TaskHubFocusField =
    | 'name' | 'status' | 'start' | 'end' | 'due'
    | 'tags' | 'color' | 'linestyle' | 'mask' | 'properties';

export interface TaskHubFormDeps {
    app: App;
    plugin: TaskViewerPlugin;
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
 */
export class TaskHubForm {
    private task: Task;
    private commitChain: Promise<void> = Promise.resolve();
    private missing = false;
    private refreshing = false;

    private nameInput: HTMLInputElement;
    private pairing: BracketPairingHandle;
    private statusPill: HTMLButtonElement;
    private dateGroup: DateFieldGroup;
    private colorInput: HTMLInputElement;
    private colorSwatch: HTMLElement;
    private nativeColorInput?: HTMLInputElement;
    private linestyleInput: HTMLInputElement;
    private maskInput: HTMLInputElement;
    private styleSourceEls: Partial<Record<'color' | 'linestyle' | 'mask', HTMLElement>> = {};
    private tagsSectionEl: HTMLElement;
    private tagAddInput: HTMLInputElement | null = null;
    private propsSectionEl: HTMLElement;
    private propAddKeyInput: HTMLInputElement | null = null;
    private errorEl: HTMLElement;
    private noticeEl: HTMLElement;

    constructor(
        private container: HTMLElement,
        task: Task,
        private deps: TaskHubFormDeps,
    ) {
        this.task = task;
        this.render();
    }

    // ==================== DOM 構築 ====================

    private render(): void {
        const c = this.container;
        c.addClass('tv-form'); // _form.css の行文法（ラベル列幅など）の適用ルート

        // --- Name ---
        const nameSection = c.createDiv({ cls: 'tv-form__name-section' });
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

        // --- Status ---
        // filter-popover と同型: pill 表示 + SuggestController（選択で即置換）
        const { row: statusRow } = createFormRow(c, t('modal.hub.status'), { icon: 'circle-check' });
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
        this.dateGroup = new DateFieldGroup(c, {
            labels: { start: t('modal.start'), end: t('modal.end'), due: t('modal.due') },
            icons: { start: 'play', end: 'square', due: 'flag' },
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

        // --- spacer: 日付セクションとタグセクションの区切り ---
        c.createDiv({ cls: 'task-hub__section-spacer' });

        // --- Tags ---
        this.tagsSectionEl = c.createDiv({ cls: 'task-hub__tags' });
        this.rebuildTagsSection(true);

        // --- Color / Linestyle / Mask ---
        this.renderStyleRow(c, 'color', t('modal.hub.color'));
        this.renderStyleRow(c, 'linestyle', t('modal.hub.linestyle'));
        this.renderStyleRow(c, 'mask', t('modal.hub.mask'));

        // --- Custom properties ---
        c.createEl('h4', { text: t('modal.hub.properties'), cls: 'tv-form__section-label' });
        this.propsSectionEl = c.createDiv({ cls: 'task-hub__props' });
        this.rebuildPropsSection(true);

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

    // ==================== 非時刻プロパティ: tags ====================

    /**
     * タグ chips を（再）構築する。effective 表示のうち:
     * - content 由来 #tag → ロック chip（編集は name フィールドの責務）
     * - own property 宣言 → ×付き chip（削除可）
     * - cascade 由来のみ → グレーロック chip + 出所（負の上書きは提供しない）
     */
    private rebuildTagsSection(force = false): void {
        if (!force && this.tagsSectionEl.contains(document.activeElement)) return;
        this.tagsSectionEl.empty();

        const contentTags = new Set(TagExtractor.fromContent(this.task.content ?? ''));
        const ownTags = new Set(this.task.tags);
        const keys = this.deps.plugin.settings.tvFileKeys;

        // pills（フル幅、行の外）
        const effectiveTags = getEffectiveTags(this.task);
        if (effectiveTags.length > 0) {
            const chipsEl = this.tagsSectionEl.createDiv({ cls: 'tv-ctrl__pills task-hub__tag-pills' });
            for (const tag of effectiveTags) {
                const chip = chipsEl.createSpan({ cls: 'tv-ctrl__pill task-hub__tag-chip' });
                chip.createSpan({ text: `#${tag}` });
                if (contentTags.has(tag)) {
                    chip.addClass('task-hub__tag-chip--locked');
                    chip.setAttribute('aria-label', t('modal.hub.contentTagLocked'));
                } else if (ownTags.has(tag)) {
                    const removeBtn = chip.createEl('button', { cls: 'tv-ctrl__pill-remove' });
                    setIcon(removeBtn.createSpan(), 'x');
                    removeBtn.setAttribute('aria-label', t('modal.hub.removeTag', { tag }));
                    removeBtn.disabled = this.missing;
                    removeBtn.addEventListener('click', () => this.commitTags(this.task.tags.filter(x => x !== tag)));
                } else {
                    const source = CascadeSource.forTag(this.deps.app, this.task, keys, tag);
                    chip.addClass('task-hub__tag-chip--locked');
                    chip.addClass('task-hub__tag-chip--cascade');
                    chip.setAttribute('aria-label', t('modal.hub.cascadeTagLocked', { source: this.sourceLabel(source) }));
                }
            }
        }

        // label + input の行（中央揃え — 他フィールドと同じ）
        const { row } = createFormRow(this.tagsSectionEl, t('modal.hub.tags'), { icon: 'tags' });
        const inputWrap = row.createDiv({ cls: 'tv-ctrl__input-wrap task-hub__tag-add-wrap tv-form__control' });
        const input = inputWrap.createEl('input', {
            type: 'text',
            placeholder: t('modal.hub.addTag'),
            cls: 'tv-ctrl__input',
        });
        this.tagAddInput = input;
        input.disabled = this.missing;

        const addTags = (raw: string) => {
            const added = raw.split(/\s+/).map(s => s.replace(/^#/, '')).filter(s => s.length > 0);
            if (added.length === 0) return;
            input.value = '';
            this.commitTags([...this.task.tags, ...added]);
        };

        this.attachSuggest(input, inputWrap, {
            getCandidates: (query) => {
                const q = query.toLowerCase().replace(/^#/, '');
                const selected = new Set(getEffectiveTags(this.task));
                return FilterValueCollector.collectTags(this.deps.readService.getTasks())
                    .filter(v => !selected.has(v))
                    .filter(v => !q || v.toLowerCase().includes(q));
            },
            renderItem: (item, val) => { item.createSpan().setText(`#${val}`); },
            onPick: (val) => addTags(val),
        });
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) {
                const raw = input.value.trim();
                if (raw) addTags(raw);
            } else if (e.key === 'Backspace' && !input.value) {
                // 空入力での Backspace は末尾の削除可能タグ（own 宣言かつ
                // content 由来でない）を除去する — filter pill と同じ操作感
                const removable = this.task.tags.filter(x => !contentTags.has(x));
                const last = removable[removable.length - 1];
                if (last) this.commitTags(this.task.tags.filter(x => x !== last));
            }
        });
    }

    private commitTags(tags: string[]): void {
        if (this.missing) return;
        this.queue(TaskUpdateBuilder.tags(this.task, tags));
        // 構造コミット（chip の増減）は楽観 model から即時再描画する。
        // echo 待ちだと focus がセクション内にある間 chip が現れ/消えない。
        const restoreFocus = document.activeElement === this.tagAddInput;
        this.deps.stack.closeAll();
        this.rebuildTagsSection(true);
        if (restoreFocus) this.tagAddInput?.focus();
    }

    // ==================== 非時刻プロパティ: color / linestyle / mask ====================

    private renderStyleRow(container: HTMLElement, field: 'color' | 'linestyle' | 'mask', label: string): void {
        const STYLE_ICONS: Record<string, string> = { color: 'palette', linestyle: 'pen-line', mask: 'eye-off' };
        const { row } = createFormRow(container, label, { icon: STYLE_ICONS[field] });

        let input: HTMLInputElement;

        if (field === 'color') {
            // 日付/時刻 picker と同じ構造: 左端アイコンボタン + native overlay + [swatch]text input
            const wrapper = row.createDiv({ cls: 'tv-form__input-with-picker tv-form__input-with-picker--color tv-form__control' });

            const pickerButton = wrapper.createDiv({ cls: 'tv-form__picker-button' });
            setIcon(pickerButton.createSpan(), 'palette');

            this.nativeColorInput = wrapper.createEl('input', { cls: 'tv-form__native-picker-input' });
            this.nativeColorInput.type = 'color';
            this.nativeColorInput.setAttribute('aria-hidden', 'true');

            this.nativeColorInput.addEventListener('click', () => {
                try { this.nativeColorInput!.showPicker(); } catch { /* iPad: direct tap opens */ }
            });
            pickerButton.addEventListener('click', () => {
                try { this.nativeColorInput!.showPicker(); } catch {
                    this.nativeColorInput!.focus();
                    this.nativeColorInput!.click();
                }
            });

            // swatch はテキスト入力内の左端にインライン配置
            this.colorSwatch = wrapper.createSpan({ cls: 'tv-ctrl__color-swatch task-hub__color-swatch' });

            input = wrapper.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow' });
        } else {
            input = row.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
        }
        input.value = this.task[field] ?? '';

        const sourceEl = row.createSpan({ cls: 'task-hub__source' });
        sourceEl.addEventListener('click', () => this.jumpToFile());
        this.styleSourceEls[field] = sourceEl;

        const commit = () => this.commitStyleField(field);
        if (field === 'color') {
            this.colorInput = input;
            if (this.nativeColorInput) {
                const nci = this.nativeColorInput;
                nci.value = this.resolveColorForPicker(input.value);
                // ドラッグ中は swatch とテキストだけ更新し、nci.value への
                // 書き戻し（updateColorSwatch 内）を避ける — 書き戻すと
                // ピッカーの内部状態が壊れるフィードバックループになる
                nci.addEventListener('input', () => {
                    input.value = nci.value.replace(/^#/, '');
                    if (this.colorSwatch) {
                        this.colorSwatch.style.backgroundColor = nci.value;
                    }
                });
                nci.addEventListener('change', () => {
                    this.updateColorSwatch();
                    commit();
                });
            }
            this.attachSuggest(input, input, {
                getCandidates: (q) => (q.trim() === '' ? filterColors('', 20) : filterColors(q)),
                renderItem: (item, val) => renderColorSuggestion(val, item),
                onPick: (val) => { input.value = val; this.updateColorSwatch(); commit(); },
            });
            input.addEventListener('input', () => this.updateColorSwatch());
        } else if (field === 'linestyle') {
            this.linestyleInput = input;
            this.attachSuggest(input, input, {
                getCandidates: (q) => filterLineStyles(q),
                renderItem: (item, val) => renderLineStyleSuggestion(val, item),
                onPick: (val) => { input.value = val; commit(); },
            });
        } else {
            this.maskInput = input;
        }

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) commit();
        });

        this.updateStyleDecoration(field);
    }

    private commitStyleField(field: 'color' | 'linestyle' | 'mask'): void {
        if (this.missing) return;
        const input = field === 'color' ? this.colorInput : field === 'linestyle' ? this.linestyleInput : this.maskInput;
        const value = input.value.trim();

        input.classList.remove('tv-ctrl__text-input--invalid');
        if (field === 'linestyle' && value && !VALID_LINE_STYLES.has(value.toLowerCase())) {
            input.classList.add('tv-ctrl__text-input--invalid');
            return;
        }

        this.queue(TaskUpdateBuilder.styleField(this.task, field, value));
    }

    /** cascade placeholder + 出所ラベル + swatch の同期 */
    private updateStyleDecoration(field: 'color' | 'linestyle' | 'mask'): void {
        const input = field === 'color' ? this.colorInput : field === 'linestyle' ? this.linestyleInput : this.maskInput;
        const sourceEl = this.styleSourceEls[field];
        if (!input || !sourceEl) return;

        const cascadeValue = this.task.cascadeContext?.[field];
        input.placeholder = (this.task[field] === undefined && cascadeValue) || '';

        const keys = this.deps.plugin.settings.tvFileKeys;
        const source = CascadeSource.forStyleField(this.deps.app, this.task, keys, field);
        if (source) {
            sourceEl.setText(this.sourceLabel(source));
            sourceEl.style.display = '';
        } else {
            sourceEl.setText('');
            sourceEl.style.display = 'none';
        }

        if (field === 'color') this.updateColorSwatch();
    }

    private updateColorSwatch(): void {
        if (!this.colorSwatch) return;
        const value = this.colorInput.value.trim() || this.task.cascadeContext?.color || '';
        this.colorSwatch.style.backgroundColor = value
            ? (/^[0-9a-fA-F]{3,6}$/.test(value) ? `#${value}` : value)
            : 'transparent';
        if (this.nativeColorInput) {
            this.nativeColorInput.value = this.resolveColorForPicker(value);
        }
    }

    private resolveColorForPicker(raw: string): string {
        const v = raw.trim();
        if (!v) return '#000000';
        if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
        if (/^[0-9a-fA-F]{3}$/.test(v)) {
            return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
        }
        // CSS 色名 → canvas で正規化（'red' → '#ff0000'）
        const ctx = document.createElement('canvas').getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#000000';
            ctx.fillStyle = v;
            return ctx.fillStyle;
        }
        return '#000000';
    }

    // ==================== 非時刻プロパティ: custom properties ====================

    /**
     * カスタムプロパティ行を（再）構築する。
     * - own キー: value 編集可 + 行削除ボタン
     * - cascade 由来のみのキー: グレー行。value を編集し確定すると own 上書きに昇格
     * - tvFile の array 型 own キー: readonly（join 平坦化の round-trip 破壊防止）
     */
    private rebuildPropsSection(force = false): void {
        if (!force && this.propsSectionEl.contains(document.activeElement)) return;
        this.propsSectionEl.empty();

        // render 時スナップショット。表示判定（isOwn / pv）専用 — commit の
        // merge base には使わない。focus ガードで rebuild がスキップされる間に
        // 他行の commit が echo されると陳腐化するため、各 closure は
        // this.task.properties を発火時に読む（tags と同じ規則）。
        const own = this.task.properties ?? {};
        const effective = getEffectiveProperties(this.task);
        const keys = this.deps.plugin.settings.tvFileKeys;

        for (const [key, pv] of Object.entries(effective)) {
            const isOwn = key in own;
            const arrayReadOnly = isOwn && isTvFile(this.task) && pv.type === 'array';

            const { row } = createFormRow(this.propsSectionEl, key);
            if (!isOwn) row.addClass('task-hub__row--cascade');

            const valueInput = row.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
            valueInput.value = pv.value;
            valueInput.disabled = this.missing || arrayReadOnly;
            if (arrayReadOnly) valueInput.setAttribute('aria-label', t('modal.hub.arrayReadOnly'));

            const commitValue = () => {
                const raw = valueInput.value;
                const live = this.task.properties ?? {};
                if (isOwn && raw === live[key]?.value) return;
                if (!isOwn && raw === pv.value) return; // cascade 値のまま → 上書きを作らない
                this.commitProps({ ...live, [key]: { value: raw, type: ChildLineClassifier.inferType(raw) } });
            };
            if (!arrayReadOnly) {
                this.attachSuggest(valueInput, valueInput, {
                    getCandidates: (q) => FilterValueCollector
                        .collectPropertyValuesForKey(this.deps.readService.getTasks(), key)
                        .filter(v => !q || v.toLowerCase().includes(q.toLowerCase())),
                    onPick: (val) => { valueInput.value = val; commitValue(); },
                });
            }
            valueInput.addEventListener('blur', commitValue);
            valueInput.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.isComposing) commitValue();
            });

            if (isOwn && !arrayReadOnly) {
                const removeBtn = row.createEl('button', { cls: 'tv-ctrl__pill-remove' });
                setIcon(removeBtn.createSpan(), 'x');
                removeBtn.setAttribute('aria-label', t('modal.hub.removeProperty', { key }));
                removeBtn.disabled = this.missing;
                removeBtn.addEventListener('click', () => {
                    const next = { ...(this.task.properties ?? {}) };
                    delete next[key];
                    this.commitProps(next);
                    // 構造コミット: 楽観 model から行を即時再構築
                    this.deps.stack.closeAll();
                    this.rebuildPropsSection(true);
                });
            } else if (!isOwn) {
                const source = CascadeSource.forProperty(this.deps.app, this.task, keys, key, pv.value);
                const sourceEl = row.createSpan({ cls: 'task-hub__source', text: this.sourceLabel(source) });
                sourceEl.addEventListener('click', () => this.jumpToFile());
            }
        }

        // 追加行 — キーはラベル列に収め、値 input の左端を上の行と揃える
        const { row: addRow, labelEl: addLabelEl } = createFormRow(this.propsSectionEl, '');
        addRow.addClass('task-hub__prop-add');
        const keyInput = addLabelEl.createEl('input', {
            type: 'text', placeholder: t('modal.hub.propertyKey'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        const valueInput = addRow.createEl('input', {
            type: 'text', placeholder: t('modal.hub.propertyValue'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
        });
        keyInput.disabled = this.missing;
        valueInput.disabled = this.missing;
        this.propAddKeyInput = keyInput;

        // 候補: 既存キー（vault 全体）から未使用のもの / 値はキーに応じて
        this.attachSuggest(keyInput, keyInput, {
            getCandidates: (q) => {
                const used = new Set(Object.keys(effective));
                return FilterValueCollector.collectPropertyKeys(this.deps.readService.getTasks())
                    .filter(k => !used.has(k))
                    .filter(k => !q || k.toLowerCase().includes(q.toLowerCase()));
            },
            onPick: (val) => { keyInput.value = val; valueInput.focus(); },
        });
        this.attachSuggest(valueInput, valueInput, {
            getCandidates: (q) => {
                const key = keyInput.value.trim();
                if (!key) return [];
                return FilterValueCollector
                    .collectPropertyValuesForKey(this.deps.readService.getTasks(), key)
                    .filter(v => !q || v.toLowerCase().includes(q.toLowerCase()));
            },
            onPick: (val) => { valueInput.value = val; commitAdd(); },
        });

        const commitAdd = () => {
            const key = keyInput.value.trim();
            if (!key) return;
            const reserved = new Set<string>(Object.values(this.deps.plugin.settings.tvFileKeys));
            reserved.add('tags');
            reserved.add('position');
            keyInput.classList.remove('tv-ctrl__text-input--invalid');
            if (reserved.has(key)) {
                keyInput.classList.add('tv-ctrl__text-input--invalid');
                this.showFormError(t('modal.hub.reservedKey', { key }));
                return;
            }
            const raw = valueInput.value;
            this.commitProps({ ...(this.task.properties ?? {}), [key]: { value: raw, type: ChildLineClassifier.inferType(raw) } });
            // 追加成立: input をクリアして行を即時再構築し、次の入力へ focus を
            // 戻す（tags の addTags と同じ操作感）。blur コミットは持たない —
            // 途中でフォーカスを外しただけで空値プロパティが生まれるのを防ぐ。
            keyInput.value = '';
            valueInput.value = '';
            this.deps.stack.closeAll();
            this.rebuildPropsSection(true);
            this.propAddKeyInput?.focus();
        };
        for (const input of [keyInput, valueInput]) {
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.isComposing) commitAdd();
            });
        }
    }

    private commitProps(props: Record<string, PropertyValue>): void {
        if (this.missing) return;
        this.queue(TaskUpdateBuilder.customProperties(this.task, props));
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
            this.setInputValue(this.colorInput, fresh.color ?? '');
            this.setInputValue(this.linestyleInput, fresh.linestyle ?? '');
            this.setInputValue(this.maskInput, fresh.mask ?? '');
            this.dateGroup.updatePlaceholders();
            this.updateStyleDecoration('color');
            this.updateStyleDecoration('linestyle');
            this.updateStyleDecoration('mask');
            this.rebuildTagsSection();
            this.rebuildPropsSection();
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
        const inputs = [this.nameInput, this.colorInput, this.linestyleInput, this.maskInput];
        for (const i of inputs) { if (i) i.disabled = !enabled; }
        this.dateGroup?.setEnabled(enabled);
        if (this.statusPill) {
            this.statusPill.disabled = !enabled;
            this.statusPill.toggleClass('is-disabled', !enabled);
        }
        // tags / props の動的セクションは missing フラグを見て再構築する
        this.rebuildTagsSection(true);
        this.rebuildPropsSection(true);
    }

    // ==================== focus ====================

    focusField(field: TaskHubFocusField): void {
        const target = this.resolveFocusTarget(field);
        target?.focus();
        if (target instanceof HTMLInputElement) target.select();
    }

    protected resolveFocusTarget(field: TaskHubFocusField): HTMLElement | null {
        switch (field) {
            case 'name': return this.nameInput;
            case 'status': return this.statusPill ?? null;
            case 'start': return this.dateGroup?.getInput('startDate');
            case 'end': return this.dateGroup?.getInput('endDate');
            case 'due': return this.dateGroup?.getInput('dueDate');
            case 'tags': return this.tagAddInput;
            case 'color': return this.colorInput;
            case 'linestyle': return this.linestyleInput;
            case 'mask': return this.maskInput;
            case 'properties': return this.propAddKeyInput;
            default: return null;
        }
    }

}
