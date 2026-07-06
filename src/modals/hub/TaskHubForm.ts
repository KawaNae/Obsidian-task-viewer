import { App, DropdownComponent, setIcon } from 'obsidian';
import { t } from '../../i18n';
import { isTvFile, type PropertyValue, type Task } from '../../types';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import { toDisplayTask } from '../../services/display/DisplayTaskConverter';
import { buildStatusOptions } from '../../constants/statusOptions';
import { VALID_LINE_STYLES } from '../../constants/style';
import { TaskNameSuggest } from '../../suggest/TaskNameSuggest';
import { FormColorSuggest } from '../../suggest/color/FormColorSuggest';
import { FormLineStyleSuggest } from '../../suggest/line/FormLineStyleSuggest';
import { createPickerTextField } from '../form/PickerTextField';
import { attachBracketPairing, BracketPairingHandle } from '../form/bracketPairing';
import { TaskUpdateBuilder } from '../form/TaskUpdateBuilder';
import { CascadeSource, type CascadeSourceKind } from './CascadeSource';
import { getEffectiveTags, getEffectiveProperties } from '../../services/data/EffectiveProperties';
import { TagExtractor } from '../../services/parsing/utils/TagExtractor';
import { ChildLineClassifier } from '../../services/parsing/utils/ChildLineClassifier';
import { openFileInExistingOrNewTab } from '../../views/sharedLogic/NavigationUtils';
import {
    validateDateTimeFormats, validateDateRequirements, validateDateRange,
    type DateValidationError,
} from '../TaskDateValidator';
import { logError } from '../../log/log';

export type TaskHubFocusField =
    | 'name' | 'status' | 'start' | 'end' | 'due'
    | 'tags' | 'color' | 'linestyle' | 'mask' | 'properties';

export interface TaskHubFormDeps {
    app: App;
    plugin: TaskViewerPlugin;
    readService: TaskReadService;
    writeService: TaskWriteService;
    /** 継承ラベルクリック等でファイルへ遷移した後に呼ぶ（モーダルを閉じる） */
    onNavigate?: () => void;
}

type DateGroup = 'start' | 'end' | 'due';

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
    private statusDropdown: DropdownComponent;
    private startDateInput: HTMLInputElement;
    private startTimeInput: HTMLInputElement;
    private endDateInput: HTMLInputElement;
    private endTimeInput: HTMLInputElement;
    private dueDateInput: HTMLInputElement;
    private dueTimeInput: HTMLInputElement;
    private colorInput: HTMLInputElement;
    private colorSwatch: HTMLElement;
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

        // --- Name ---
        const nameSection = c.createDiv({ cls: 'tv-form__name-section' });
        nameSection.createEl('label', { text: t('modal.taskName') });
        this.nameInput = nameSection.createEl('input', {
            type: 'text',
            placeholder: t('modal.taskName'),
            cls: 'tv-form__text-input',
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
        const statusRow = c.createDiv({ cls: 'task-hub__status-row' });
        statusRow.createEl('label', { text: t('modal.hub.status') });
        this.statusDropdown = new DropdownComponent(statusRow);
        for (const opt of buildStatusOptions(this.deps.plugin.settings.statusDefinitions)) {
            this.statusDropdown.addOption(opt.char, `[${opt.char === ' ' ? ' ' : opt.char}] ${opt.label}`);
        }
        this.statusDropdown.setValue(this.task.statusChar);
        this.statusDropdown.onChange((value) => this.commitStatus(value));

        // --- Start / End / Due ---
        this.renderDateGroup(c, t('modal.start'), 'start', this.task.startDate, this.task.startTime);
        this.renderDateGroup(c, t('modal.end'), 'end', this.task.endDate, this.task.endTime);
        const dl = this.splitDue(this.task.due);
        this.renderDateGroup(c, t('modal.due'), 'due', dl.date, dl.time);

        // --- Tags ---
        c.createEl('h4', { text: t('modal.hub.tags'), cls: 'tv-form__section-label' });
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
        this.noticeEl = c.createDiv({ cls: 'tv-form__warning' });
        this.noticeEl.style.display = 'none';

        this.updatePlaceholders();
    }

    private renderDateGroup(
        container: HTMLElement,
        label: string,
        group: DateGroup,
        initialDate: string | undefined,
        initialTime: string | undefined,
    ): void {
        container.createEl('h4', { text: label, cls: 'tv-form__section-label' });
        const row = container.createDiv({ cls: 'tv-form__date-row' });

        // 視覚ラベルは置かない（picker アイコンと placeholder が型と形式を
        // 示すため冗長）。スクリーンリーダー向けに aria-label のみ付与。
        const dateDiv = row.createDiv({ cls: 'tv-form__date-row__field' });
        const dateInput = createPickerTextField(dateDiv, 'date', 'YYYY-MM-DD', initialDate || '');
        dateInput.setAttribute('aria-label', `${label} — ${t('modal.date')}`);

        const timeDiv = row.createDiv({ cls: 'tv-form__date-row__field' });
        const timeInput = createPickerTextField(timeDiv, 'time', 'HH:mm', initialTime || '');
        timeInput.setAttribute('aria-label', `${label} — ${t('modal.time')}`);

        if (group === 'start') { this.startDateInput = dateInput; this.startTimeInput = timeInput; }
        else if (group === 'end') { this.endDateInput = dateInput; this.endTimeInput = timeInput; }
        else { this.dueDateInput = dateInput; this.dueTimeInput = timeInput; }

        for (const input of [dateInput, timeInput]) {
            input.addEventListener('input', (e: Event) => {
                this.updatePlaceholders();
                this.validate();
                // picker 選択 / clear ボタンは synthetic input（isTrusted=false）
                // で届く。blur を経ないのでここで確定する。refresh() 由来の
                // synthetic は refreshing ガードで除外。
                if (!e.isTrusted && !this.refreshing) {
                    this.commitDates(group);
                }
            });
            input.addEventListener('blur', () => this.commitDates(group));
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') this.commitDates(group);
            });
        }
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

        for (const tag of getEffectiveTags(this.task)) {
            const chip = this.tagsSectionEl.createSpan({ cls: 'task-hub__tag-chip' });
            chip.createSpan({ text: `#${tag}` });
            if (contentTags.has(tag)) {
                chip.addClass('task-hub__tag-chip--locked');
                chip.setAttribute('aria-label', t('modal.hub.contentTagLocked'));
            } else if (ownTags.has(tag)) {
                const removeBtn = chip.createEl('button', { cls: 'task-hub__chip-remove' });
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

        this.tagAddInput = this.tagsSectionEl.createEl('input', {
            type: 'text',
            placeholder: t('modal.hub.addTag'),
            cls: 'task-hub__tag-add',
        });
        this.tagAddInput.disabled = this.missing;
        this.tagAddInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            const raw = this.tagAddInput!.value.trim();
            if (!raw) return;
            const added = raw.split(/\s+/).map(s => s.replace(/^#/, '')).filter(s => s.length > 0);
            if (added.length === 0) return;
            this.tagAddInput!.value = '';
            this.commitTags([...this.task.tags, ...added]);
        });
    }

    private commitTags(tags: string[]): void {
        if (this.missing) return;
        this.queue(TaskUpdateBuilder.tags(this.task, tags));
    }

    // ==================== 非時刻プロパティ: color / linestyle / mask ====================

    private renderStyleRow(container: HTMLElement, field: 'color' | 'linestyle' | 'mask', label: string): void {
        const row = container.createDiv({ cls: 'task-hub__prop-row' });
        row.createEl('label', { text: label, cls: 'task-hub__prop-label' });

        if (field === 'color') {
            this.colorSwatch = row.createSpan({ cls: 'task-hub__color-swatch' });
        }

        const input = row.createEl('input', { type: 'text', cls: 'tv-form__text-input' });
        input.value = this.task[field] ?? '';

        const sourceEl = row.createSpan({ cls: 'task-hub__source' });
        sourceEl.addEventListener('click', () => this.jumpToFile());
        this.styleSourceEls[field] = sourceEl;

        const commit = () => this.commitStyleField(field);
        if (field === 'color') {
            this.colorInput = input;
            new FormColorSuggest(this.deps.app, input, commit);
            input.addEventListener('input', () => this.updateColorSwatch());
        } else if (field === 'linestyle') {
            this.linestyleInput = input;
            new FormLineStyleSuggest(this.deps.app, input, commit);
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

        input.classList.remove('tv-form__input--invalid');
        if (field === 'linestyle' && value && !VALID_LINE_STYLES.has(value.toLowerCase())) {
            input.classList.add('tv-form__input--invalid');
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

        const own = this.task.properties ?? {};
        const effective = getEffectiveProperties(this.task);
        const keys = this.deps.plugin.settings.tvFileKeys;

        for (const [key, pv] of Object.entries(effective)) {
            const isOwn = key in own;
            const arrayReadOnly = isOwn && isTvFile(this.task) && pv.type === 'array';

            const row = this.propsSectionEl.createDiv({ cls: 'task-hub__prop-row' });
            if (!isOwn) row.addClass('task-hub__prop-row--cascade');
            row.createSpan({ text: key, cls: 'task-hub__prop-key' });

            const valueInput = row.createEl('input', { type: 'text', cls: 'tv-form__text-input' });
            valueInput.value = pv.value;
            valueInput.disabled = this.missing || arrayReadOnly;
            if (arrayReadOnly) valueInput.setAttribute('aria-label', t('modal.hub.arrayReadOnly'));

            const commitValue = () => {
                const raw = valueInput.value;
                if (isOwn && raw === own[key]?.value) return;
                if (!isOwn && raw === pv.value) return; // cascade 値のまま → 上書きを作らない
                this.commitProps({ ...own, [key]: { value: raw, type: ChildLineClassifier.inferType(raw) } });
            };
            valueInput.addEventListener('blur', commitValue);
            valueInput.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.isComposing) commitValue();
            });

            if (isOwn && !arrayReadOnly) {
                const removeBtn = row.createEl('button', { cls: 'task-hub__chip-remove' });
                setIcon(removeBtn.createSpan(), 'x');
                removeBtn.setAttribute('aria-label', t('modal.hub.removeProperty', { key }));
                removeBtn.disabled = this.missing;
                removeBtn.addEventListener('click', () => {
                    const next = { ...own };
                    delete next[key];
                    this.commitProps(next);
                });
            } else if (!isOwn) {
                const source = CascadeSource.forProperty(this.deps.app, this.task, keys, key, pv.value);
                const sourceEl = row.createSpan({ cls: 'task-hub__source', text: this.sourceLabel(source) });
                sourceEl.addEventListener('click', () => this.jumpToFile());
            }
        }

        // 追加行
        const addRow = this.propsSectionEl.createDiv({ cls: 'task-hub__prop-row task-hub__prop-add' });
        const keyInput = addRow.createEl('input', {
            type: 'text', placeholder: t('modal.hub.propertyKey'),
            cls: 'tv-form__text-input task-hub__prop-key-input',
        });
        const valueInput = addRow.createEl('input', {
            type: 'text', placeholder: t('modal.hub.propertyValue'),
            cls: 'tv-form__text-input',
        });
        keyInput.disabled = this.missing;
        valueInput.disabled = this.missing;
        this.propAddKeyInput = keyInput;

        const commitAdd = () => {
            const key = keyInput.value.trim();
            if (!key) return;
            const reserved = new Set<string>(Object.values(this.deps.plugin.settings.tvFileKeys));
            reserved.add('tags');
            reserved.add('position');
            keyInput.classList.remove('tv-form__input--invalid');
            if (reserved.has(key)) {
                keyInput.classList.add('tv-form__input--invalid');
                this.showFormError(t('modal.hub.reservedKey', { key }));
                return;
            }
            const raw = valueInput.value;
            this.commitProps({ ...own, [key]: { value: raw, type: ChildLineClassifier.inferType(raw) } });
        };
        for (const input of [keyInput, valueInput]) {
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.isComposing) commitAdd();
            });
        }
        valueInput.addEventListener('blur', commitAdd);
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
    }

    private commitDates(group: DateGroup): void {
        if (this.missing) return;
        if (!this.validate()) return;
        const updates =
            group === 'start' ? TaskUpdateBuilder.dateGroup(this.task, 'start', this.startDateInput.value, this.startTimeInput.value)
            : group === 'end' ? TaskUpdateBuilder.dateGroup(this.task, 'end', this.endDateInput.value, this.endTimeInput.value)
            : TaskUpdateBuilder.due(this.task, this.dueDateInput.value, this.dueTimeInput.value);
        this.queue(updates);
    }

    /** コミットを直列化して発行する（vault.process の競合防止） */
    protected queue(updates: Partial<Task> | null): void {
        if (!updates) return;
        const id = this.task.id;
        this.commitChain = this.commitChain
            .then(() => this.deps.writeService.updateTask(id, updates))
            .catch((e) => logError(`[TaskHubForm] commit failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    // ==================== 外部変更の取り込み ====================

    /**
     * index の変更（自書き込みの echo / 外部編集）をフォームへ反映する。
     * focus 中・IME composition 中のフィールドはスキップ。
     */
    refresh(fresh: Task): void {
        this.task = fresh;
        this.missing = false;
        this.noticeEl.style.display = 'none';
        this.setEnabled(true);

        this.refreshing = true;
        try {
            this.setInputValue(this.nameInput, fresh.content ?? '', this.pairing.isComposing());
            if (document.activeElement !== this.statusDropdown.selectEl) {
                this.statusDropdown.setValue(fresh.statusChar);
            }
            this.setInputValue(this.startDateInput, fresh.startDate ?? '');
            this.setInputValue(this.startTimeInput, fresh.startTime ?? '');
            this.setInputValue(this.endDateInput, fresh.endDate ?? '');
            this.setInputValue(this.endTimeInput, fresh.endTime ?? '');
            const dl = this.splitDue(fresh.due);
            this.setInputValue(this.dueDateInput, dl.date ?? '');
            this.setInputValue(this.dueTimeInput, dl.time ?? '');
            this.setInputValue(this.colorInput, fresh.color ?? '');
            this.setInputValue(this.linestyleInput, fresh.linestyle ?? '');
            this.setInputValue(this.maskInput, fresh.mask ?? '');
            this.updatePlaceholders();
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
        const inputs = [
            this.nameInput,
            this.startDateInput, this.startTimeInput,
            this.endDateInput, this.endTimeInput,
            this.dueDateInput, this.dueTimeInput,
            this.colorInput, this.linestyleInput, this.maskInput,
        ];
        for (const i of inputs) { if (i) i.disabled = !enabled; }
        this.statusDropdown?.setDisabled(!enabled);
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
            case 'status': return this.statusDropdown?.selectEl ?? null;
            case 'start': return this.startDateInput;
            case 'end': return this.endDateInput;
            case 'due': return this.dueDateInput;
            case 'tags': return this.tagAddInput;
            case 'color': return this.colorInput;
            case 'linestyle': return this.linestyleInput;
            case 'mask': return this.maskInput;
            case 'properties': return this.propAddKeyInput;
            default: return null;
        }
    }

    // ==================== バリデーション / placeholder ====================

    private collectFields() {
        return {
            startDate: this.startDateInput?.value.trim() || '',
            startTime: this.startTimeInput?.value.trim() || '',
            endDate: this.endDateInput?.value.trim() || '',
            endTime: this.endTimeInput?.value.trim() || '',
            dueDate: this.dueDateInput?.value.trim() || '',
            dueTime: this.dueTimeInput?.value.trim() || '',
        };
    }

    private validate(): boolean {
        const inputs = [
            this.startDateInput, this.startTimeInput,
            this.endDateInput, this.endTimeInput,
            this.dueDateInput, this.dueTimeInput,
        ];
        inputs.forEach(el => el?.classList.remove('tv-form__input--invalid'));
        this.errorEl.style.display = 'none';

        const fields = this.collectFields();
        const cascadeStart = this.task.cascadeContext?.startDate;
        const ctx = {
            hasImplicitStartDate: !!cascadeStart,
            implicitStartDate: cascadeStart,
        };

        const err = validateDateTimeFormats(fields)
            ?? validateDateRequirements(fields, ctx)
            ?? validateDateRange(fields, ctx);
        if (err) return this.applyValidationError(err);
        return true;
    }

    private applyValidationError(err: DateValidationError): false {
        const inputMap: Record<string, HTMLInputElement> = {
            startDate: this.startDateInput, startTime: this.startTimeInput,
            endDate: this.endDateInput, endTime: this.endTimeInput,
            dueDate: this.dueDateInput, dueTime: this.dueTimeInput,
        };
        inputMap[err.field]?.classList.add('tv-form__input--invalid');
        this.errorEl.empty();
        this.errorEl.setText(err.message);
        if (err.hint) {
            this.errorEl.createEl('br');
            this.errorEl.appendText(err.hint);
        }
        this.errorEl.style.display = 'block';
        return false;
    }

    /**
     * 暗黙値プレースホルダの再計算。フォーム値を task に overlay して
     * toDisplayTask に通す — cascadeContext を保持したまま解決するので
     * section / file 継承の暗黙値もそのまま placeholder に現れる。
     */
    private updatePlaceholders(): void {
        const f = this.collectFields();
        const overlay: Task = {
            ...this.task,
            startDate: f.startDate || undefined,
            startTime: f.startTime || undefined,
            endDate: f.endDate || undefined,
            endTime: f.endTime || undefined,
            due: f.dueDate ? (f.dueTime ? `${f.dueDate}T${f.dueTime}` : f.dueDate) : undefined,
        };
        const dt = toDisplayTask(overlay, this.deps.plugin.settings.startHour, (id) => this.deps.readService.getTask(id));

        if (this.startDateInput) {
            this.startDateInput.placeholder = (dt.startDateImplicit && dt.effectiveStartDate) || 'YYYY-MM-DD';
        }
        if (this.startTimeInput) {
            this.startTimeInput.placeholder =
                (dt.startTimeImplicit && dt.effectiveStartDate && dt.effectiveStartTime) || 'HH:mm';
        }
        if (this.endDateInput) {
            this.endDateInput.placeholder = (dt.endDateImplicit && dt.effectiveEndDate) || 'YYYY-MM-DD';
        }
        if (this.endTimeInput) {
            this.endTimeInput.placeholder =
                (dt.endTimeImplicit && dt.effectiveEndDate && dt.effectiveEndTime) || 'HH:mm';
        }
    }

    private splitDue(due: string | undefined): { date: string | undefined; time: string | undefined } {
        if (!due) return { date: undefined, time: undefined };
        if (due.includes('T')) {
            const [date, time] = due.split('T');
            return { date, time };
        }
        return { date: due, time: undefined };
    }
}
