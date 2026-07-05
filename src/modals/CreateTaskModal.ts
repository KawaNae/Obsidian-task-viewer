import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import { DisplayTask, Task } from '../types';
import { TaskParser } from '../services/parsing/TaskParser';
import { NO_TASK_LOOKUP, toDisplayTask } from '../services/display/DisplayTaskConverter';
import { createTempTask } from '../services/data/createTempTask';
import { validateDateTimeFormats, validateDateRequirements, validateDateRange, type DateValidationError } from './TaskDateValidator';
import { TaskNameSuggest } from '../suggest/TaskNameSuggest';
import { createPickerTextField } from './form/PickerTextField';
import { attachBracketPairing } from './form/bracketPairing';

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

export class CreateTaskModal extends Modal {
    private result: CreateTaskResult;
    private onSubmit: (result: CreateTaskResult) => void;
    private options: CreateTaskModalOptions;

    private startDateInput: HTMLInputElement;
    private startTimeInput: HTMLInputElement;
    private endDateInput: HTMLInputElement;
    private endTimeInput: HTMLInputElement;
    private dueDateInput: HTMLInputElement;
    private dueTimeInput: HTMLInputElement;
    private nameInput: HTMLInputElement;
    private errorEl: HTMLElement;
    private warningEl: HTMLElement;

    constructor(app: App, onSubmit: (result: CreateTaskResult) => void, initialValues: Partial<CreateTaskResult> = {}, options: CreateTaskModalOptions = {}) {
        super(app);
        this.onSubmit = onSubmit;
        this.result = { content: '', ...initialValues };
        this.options = options;
    }

    onOpen() {
        // CSS hook for the shared close-animation fix; see _modal.css
        // `.mod-tv-modal` rule.
        this.containerEl.addClass('mod-tv-modal');
        const { contentEl } = this;

        contentEl.createEl('h2', { text: this.options.title ?? t('modal.createTask') });

        // --- Task Name (input with [[wikilink]] / #tag suggest) ---
        const nameSection = contentEl.createDiv({ cls: 'tv-form__name-section' });
        nameSection.createEl('label', { text: t('modal.taskName') });
        this.nameInput = nameSection.createEl('input', {
            type: 'text',
            placeholder: t('modal.taskName'),
            cls: 'tv-form__text-input',
        });
        this.nameInput.value = this.result.content ?? '';
        new TaskNameSuggest(this.app, this.nameInput);
        attachBracketPairing(this.nameInput, () => {
            this.result.content = this.nameInput.value;
            this.validateInputs();
        });
        this.nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') this.submit();
        });

        // --- Start ---
        this.renderDateTimeSection(
            contentEl, t('modal.start'),
            this.result.startDate, this.result.startTime,
            'start'
        );

        // --- End ---
        this.renderDateTimeSection(
            contentEl, t('modal.end'),
            this.result.endDate, this.result.endTime,
            'end'
        );

        // --- Due ---
        // Due is stored as a single string (YYYY-MM-DD or YYYY-MM-DDThh:mm); split for inputs
        const dlParts = this.splitDue(this.result.due);
        this.renderDateTimeSection(
            contentEl, t('modal.due'),
            dlParts.date, dlParts.time,
            'due'
        );

        // Set initial placeholders based on initialValues
        this.updatePlaceholders();

        // --- Error / Warning display ---
        this.errorEl = contentEl.createDiv({ cls: 'tv-form__error' });
        this.errorEl.style.display = 'none';
        this.warningEl = contentEl.createDiv({ cls: 'tv-form__warning' });
        this.warningEl.style.display = 'none';

        // --- Create button ---
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText(this.options.submitLabel ?? t('modal.create'))
                    .setCta()
                    .onClick(() => this.submit()));

    }

    private renderDateTimeSection(
        container: HTMLElement,
        label: string,
        initialDate: string | undefined,
        initialTime: string | undefined,
        section: 'start' | 'end' | 'due'
    ) {
        container.createEl('h4', { text: label, cls: 'tv-form__section-label' });

        const row = container.createDiv({ cls: 'tv-form__date-row' });

        // Date field (placeholder set later by updatePlaceholders())
        const dateDiv = row.createDiv({ cls: 'tv-form__date-row__field' });
        dateDiv.createEl('label', { text: t('modal.date') });
        const dateInput = createPickerTextField(dateDiv, 'date', 'YYYY-MM-DD', initialDate || '');

        // Time field (placeholder set later by updatePlaceholders())
        const timeDiv = row.createDiv({ cls: 'tv-form__date-row__field' });
        timeDiv.createEl('label', { text: t('modal.time') });
        const timeInput = createPickerTextField(timeDiv, 'time', 'HH:mm', initialTime || '');

        // Store refs
        if (section === 'start') { this.startDateInput = dateInput; this.startTimeInput = timeInput; }
        else if (section === 'end') { this.endDateInput = dateInput; this.endTimeInput = timeInput; }
        else { this.dueDateInput = dateInput; this.dueTimeInput = timeInput; }

        // Event listeners: update result and validate
        const update = () => {
            const d = dateInput.value.trim() || undefined;
            const t = timeInput.value.trim() || undefined;

            if (section === 'start') {
                this.result.startDate = d;
                this.result.startTime = t;
            } else if (section === 'end') {
                this.result.endDate = d;
                this.result.endTime = t;
            } else {
                this.result.due = d ? (t ? `${d}T${t}` : d) : undefined;
            }

            this.updatePlaceholders();
            this.validateInputs();
        };

        dateInput.addEventListener('input', update);
        timeInput.addEventListener('input', update);
        dateInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') this.submit(); });
        timeInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') this.submit(); });
    }

    private validateInputs(): boolean {
        const inputs = [
            this.startDateInput, this.startTimeInput,
            this.endDateInput, this.endTimeInput,
            this.dueDateInput, this.dueTimeInput
        ];
        inputs.forEach(el => el?.classList.remove('tv-form__input--invalid'));
        this.errorEl.style.display = 'none';

        const fields = {
            startDate: this.startDateInput?.value.trim() || '',
            startTime: this.startTimeInput?.value.trim() || '',
            endDate: this.endDateInput?.value.trim() || '',
            endTime: this.endTimeInput?.value.trim() || '',
            dueDate: this.dueDateInput?.value.trim() || '',
            dueTime: this.dueTimeInput?.value.trim() || '',
        };

        const formatErr = validateDateTimeFormats(fields);
        if (formatErr) return this.applyValidationError(formatErr);

        const reqErr = validateDateRequirements(fields, { hasImplicitStartDate: !!this.options.dailyNoteDate });
        if (reqErr) return this.applyValidationError(reqErr);

        const rangeErr = validateDateRange(fields, {
            hasImplicitStartDate: !!this.options.dailyNoteDate,
            implicitStartDate: this.options.dailyNoteDate,
        });
        if (rangeErr) return this.applyValidationError(rangeErr);

        // Warning: empty task won't appear in viewer
        const { startDate: sd, startTime: st, endDate: ed, endTime: et, dueDate: dd, dueTime: dt } = fields;
        if (this.options.warnOnEmptyTask && !this.result.content.trim() && !sd && !st && !ed && !et && !dd && !dt) {
            this.warningEl.setText(t('modal.emptyTaskWarning'));
            this.warningEl.style.display = 'block';
        } else {
            this.warningEl.style.display = 'none';
        }

        return true;
    }

    private applyValidationError(err: DateValidationError): false {
        const inputMap: Record<string, HTMLInputElement> = {
            startDate: this.startDateInput, startTime: this.startTimeInput,
            endDate: this.endDateInput, endTime: this.endTimeInput,
            dueDate: this.dueDateInput, dueTime: this.dueTimeInput,
        };
        inputMap[err.field]?.classList.add('tv-form__input--invalid');
        this.showError(err.message, err.hint);
        return false;
    }

    private showError(message: string, hint?: string) {
        this.errorEl.empty();
        this.errorEl.setText(message);
        if (hint) {
            this.errorEl.createEl('br');
            this.errorEl.appendText(hint);
        }
        this.errorEl.style.display = 'block';
    }

    /**
     * Recalculate all implicit placeholders based on current result values.
     * Builds a partial Task from the form state and runs it through toDisplayTask()
     * to get the same implicit resolution used everywhere else.
     */
    private updatePlaceholders(): void {
        const startHour = this.options.startHour ?? 0;

        // Build a partial Task from current form values.
        // Synthetic temp task built from form input — no children to materialize.
        const formTask = createTempTask({
            id: 'placeholder-temp',
            startDate: this.result.startDate || this.options.dailyNoteDate,
            startTime: this.result.startTime,
            endDate: this.result.endDate,
            endTime: this.result.endTime,
        });
        const dt = toDisplayTask(formTask, startHour, NO_TASK_LOOKUP);

        // --- Start Date placeholder ---
        if (this.startDateInput) {
            this.startDateInput.placeholder =
                (dt.startDateImplicit && dt.effectiveStartDate) || this.options.dailyNoteDate || 'YYYY-MM-DD';
        }

        // --- Start Time placeholder ---
        if (this.startTimeInput) {
            // Show implicit time when there's a date context (explicit or resolved from end)
            this.startTimeInput.placeholder =
                (dt.startTimeImplicit && dt.effectiveStartDate && dt.effectiveStartTime) || 'HH:mm';
        }

        // --- End Date placeholder ---
        if (this.endDateInput) {
            this.endDateInput.placeholder =
                (dt.endDateImplicit && dt.effectiveEndDate) || this.options.dailyNoteDate || 'YYYY-MM-DD';
        }

        // --- End Time placeholder ---
        if (this.endTimeInput) {
            // Show implicit time when there's an end date context
            this.endTimeInput.placeholder =
                (dt.endTimeImplicit && dt.effectiveEndDate && dt.effectiveEndTime) || 'HH:mm';
        }
    }

    /** Split a due string ("YYYY-MM-DD" or "YYYY-MM-DDThh:mm") into date and time parts */
    private splitDue(due: string | undefined): { date: string | undefined; time: string | undefined } {
        if (!due) return { date: undefined, time: undefined };
        if (due.includes('T')) {
            const [date, time] = due.split('T');
            return { date, time };
        }
        return { date: due, time: undefined };
    }

    submit() {
        if (!this.validateInputs()) return;

        this.close();
        this.onSubmit(this.result);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
