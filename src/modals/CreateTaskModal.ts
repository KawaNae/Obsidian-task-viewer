import { App, Setting } from 'obsidian';
import { t } from '../i18n';
import { Task } from '../types';
import { TaskParser } from '../services/parsing/TaskParser';
import { NO_TASK_LOOKUP } from '../services/display/DisplayTaskConverter';
import { createTempTask } from '../services/data/createTempTask';
import { TaskNameSuggest } from '../suggest/TaskNameSuggest';
import { attachBracketPairing } from './form/bracketPairing';
import { DateFieldGroup } from './form/DateFieldGroup';
import { OverlayShell } from '../views/sharedUI/OverlayShell';

export interface CreateTaskResult {
    content: string;
    startDate?: string;   // YYYY-MM-DD
    startTime?: string;   // HH:mm
    endDate?: string;     // YYYY-MM-DD
    endTime?: string;     // HH:mm
    due?: string;    // YYYY-MM-DD or YYYY-MM-DDThh:mm
}

/**
 * Format a CreateTaskResult into a markdown task line (e.g. "- [ ] 会議 @2026-02-05T10:00>11:00").
 * Uses TaskParser.format() to ensure notation is consistent with the rest of the plugin.
 */
export function formatTaskLine(result: CreateTaskResult): string {
    const task = createTempTask({
        id: 'create-temp',
        content: result.content,
        startDate: result.startDate,
        startTime: result.startTime,
        endDate: result.endDate,
        endTime: result.endTime,
        due: result.due,
    });
    return TaskParser.format(task);
}

export interface CreateTaskModalOptions {
    /** Show a warning when task name and all date fields are empty (task won't appear in viewer) */
    warnOnEmptyTask?: boolean;
    /** Modal title text */
    title?: string;
    /** Submit button label */
    submitLabel?: string;
    /** Daily note date (YYYY-MM-DD). Shown as Start Date placeholder when startDate is omitted (inherited from filename). */
    dailyNoteDate?: string;
    /** Start hour for implicit value resolution via toDisplayTask(). */
    startHour?: number;
}

/**
 * 新規タスク作成フォーム。
 *
 * Obsidian Modal ではなく OverlayShell (mode: 'centered') に載せる —
 * desktop は中央ダイアログ、phone は bottom-sheet（swipe dismiss・
 * keyboard awareness・close animation 込み）。パネル寸法は共通の
 * tv-overlay__panel--dialog（_overlay.css）。
 */
export class CreateTaskModal {
    private overlay = new OverlayShell();
    private result: CreateTaskResult;
    private onSubmit: (result: CreateTaskResult) => void;
    private options: CreateTaskModalOptions;

    private nameInput: HTMLInputElement;
    private dateGroup: DateFieldGroup;
    private warningEl: HTMLElement;

    constructor(private app: App, onSubmit: (result: CreateTaskResult) => void, initialValues: Partial<CreateTaskResult> = {}, options: CreateTaskModalOptions = {}) {
        this.onSubmit = onSubmit;
        this.result = { content: '', ...initialValues };
        this.options = options;
    }

    open(): void {
        if (this.overlay.isOpen()) return;
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog create-task',
            build: (bodyEl) => this.buildContent(bodyEl),
        });
    }

    close(): void {
        this.overlay.close();
    }

    private buildContent(bodyEl: HTMLElement): void {
        // tv-ctrl は overlay root に付与済み。行文法のルートだけ足す
        bodyEl.addClass('tv-form');

        bodyEl.createEl('h2', { text: this.options.title ?? t('modal.createTask'), cls: 'create-task__title' });

        // --- Task Name ---
        const nameSection = bodyEl.createDiv({ cls: 'tv-form__name-section' });
        nameSection.createEl('label', { text: t('modal.taskName') });
        this.nameInput = nameSection.createEl('input', {
            type: 'text',
            placeholder: t('modal.taskName'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        this.nameInput.value = this.result.content ?? '';
        new TaskNameSuggest(this.app, this.nameInput);
        attachBracketPairing(this.nameInput, () => {
            this.result.content = this.nameInput.value;
            this.checkWarning();
        });
        this.nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') this.submit();
        });

        // --- Start / End / Due ---
        const dlParts = DateFieldGroup.splitDue(this.result.due);
        this.dateGroup = new DateFieldGroup(bodyEl, {
            labels: { start: t('modal.start'), end: t('modal.end'), due: t('modal.due') },
            initial: {
                startDate: this.result.startDate || '',
                startTime: this.result.startTime || '',
                endDate: this.result.endDate || '',
                endTime: this.result.endTime || '',
                dueDate: dlParts.date || '',
                dueTime: dlParts.time || '',
            },
            buildOverlayTask: (f) => createTempTask({
                id: 'placeholder-temp',
                startDate: f.startDate || this.options.dailyNoteDate,
                startTime: f.startTime,
                endDate: f.endDate,
                endTime: f.endTime,
            }),
            getStartHour: () => this.options.startHour ?? 0,
            taskLookup: NO_TASK_LOOKUP,
            getValidationCtx: () => ({
                hasImplicitStartDate: !!this.options.dailyNoteDate,
                implicitStartDate: this.options.dailyNoteDate,
            }),
            getFallbackDatePlaceholder: () => this.options.dailyNoteDate,
            onInput: (_group, f) => {
                const d = f.startDate || undefined;
                const st = f.startTime || undefined;
                const ed = f.endDate || undefined;
                const et = f.endTime || undefined;
                this.result.startDate = d;
                this.result.startTime = st;
                this.result.endDate = ed;
                this.result.endTime = et;
                this.result.due = f.dueDate ? (f.dueTime ? `${f.dueDate}T${f.dueTime}` : f.dueDate) : undefined;
                this.checkWarning();
            },
            onEnter: () => this.submit(),
        });

        this.dateGroup.updatePlaceholders();

        // --- Error / Warning ---
        const errorEl = bodyEl.createDiv({ cls: 'tv-form__error' });
        errorEl.style.display = 'none';
        this.dateGroup.bindErrorEl(errorEl);
        this.warningEl = bodyEl.createDiv({ cls: 'tv-form__warning' });
        this.warningEl.style.display = 'none';

        // --- Create button ---
        new Setting(bodyEl)
            .addButton((btn) =>
                btn
                    .setButtonText(this.options.submitLabel ?? t('modal.create'))
                    .setCta()
                    .onClick(() => this.submit()));
    }

    private checkWarning(): void {
        if (!this.options.warnOnEmptyTask) return;
        const f = this.dateGroup.collect();
        const empty = !this.result.content.trim()
            && !f.startDate && !f.startTime && !f.endDate && !f.endTime && !f.dueDate && !f.dueTime;
        if (empty) {
            this.warningEl.setText(t('modal.emptyTaskWarning'));
            this.warningEl.style.display = 'block';
        } else {
            this.warningEl.style.display = 'none';
        }
    }

    submit() {
        if (!this.dateGroup.validate()) return;

        this.close();
        this.onSubmit(this.result);
    }
}
