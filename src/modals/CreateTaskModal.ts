import { App, Modal, Setting, setIcon } from 'obsidian';
import { t } from '../i18n';
import { DisplayTask, Task } from '../types';
import { TaskParser } from '../services/parsing/TaskParser';
import { toDisplayTask } from '../utils/DisplayTaskConverter';
import { validateDateTimeFormats, validateDateRequirements, validateDateRange, type DateValidationError } from '../utils/TaskDateValidator';
import { TaskNameSuggest } from '../suggest/TaskNameSuggest';

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
    const task: Task = {
        id: 'create-temp',
        file: '',
        line: 0,
        indent: 0,
        content: result.content,
        statusChar: ' ',
        childIds: [],
        childLines: [],
        startDate: result.startDate,
        startTime: result.startTime,
        endDate: result.endDate,
        endTime: result.endTime,
        due: result.due,
        commands: [],
        originalText: '',
        childLineBodyOffsets: [],
        tags: [],
        parserId: 'at-notation',
        properties: {},
    };
    return TaskParser.format(task);
}

export interface CreateTaskModalOptions {
    /** Show a warning when task name and all date fields are empty (task won't appear in viewer) */
    warnOnEmptyTask?: boolean;
    /** Modal title text */
    title?: string;
    /** Submit button label */
    submitLabel?: string;
    /** Initial focus field */
    focusField?: 'name' | 'start' | 'end' | 'due';
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
    private lastDisplayTask: DisplayTask | undefined;

    constructor(app: App, onSubmit: (result: CreateTaskResult) => void, initialValues: Partial<CreateTaskResult> = {}, options: CreateTaskModalOptions = {}) {
        super(app);
        this.onSubmit = onSubmit;
        this.result = { content: '', ...initialValues };
        this.options = options;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h2', { text: this.options.title ?? t('modal.createTask') });

        // --- Task Name (input with [[wikilink]] / #tag suggest) ---
        const nameSection = contentEl.createDiv({ cls: 'create-task-modal__name-section' });
        nameSection.createEl('label', { text: t('modal.taskName') });
        this.nameInput = nameSection.createEl('input', {
            type: 'text',
            placeholder: t('modal.taskName'),
            cls: 'create-task-modal__text-input',
        });
        this.nameInput.value = this.result.content ?? '';
        new TaskNameSuggest(this.app, this.nameInput);
        this.nameInput.addEventListener('input', () => {
            this.result.content = this.nameInput.value;
            this.validateInputs();
        });
        this.nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') this.submit();
            this.handleBracketPairing(e);
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
        this.errorEl = contentEl.createDiv({ cls: 'create-task-modal__error' });
        this.errorEl.style.display = 'none';
        this.warningEl = contentEl.createDiv({ cls: 'create-task-modal__warning' });
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
        container.createEl('h4', { text: label, cls: 'create-task-modal__section-label' });

        const row = container.createDiv({ cls: 'create-task-modal__date-row' });

        // Date field (placeholder set later by updatePlaceholders())
        const dateDiv = row.createDiv({ cls: 'create-task-modal__date-row__field' });
        dateDiv.createEl('label', { text: 'Date' });
        const dateInput = this.createPickerTextInput(
            dateDiv,
            'date',
            'YYYY-MM-DD',
            initialDate || ''
        );

        // Time field (placeholder set later by updatePlaceholders())
        const timeDiv = row.createDiv({ cls: 'create-task-modal__date-row__field' });
        timeDiv.createEl('label', { text: 'Time' });
        const timeInput = this.createPickerTextInput(
            timeDiv,
            'time',
            'HH:mm',
            initialTime || ''
        );

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

    private createPickerTextInput(
        container: HTMLElement,
        pickerType: 'date' | 'time',
        placeholder: string,
        initialValue: string
    ): HTMLInputElement {
        const wrapper = container.createDiv({ cls: 'create-task-modal__input-with-picker' });

        // Visual icon button (left side)
        const pickerButton = wrapper.createDiv({
            cls: 'create-task-modal__picker-button'
        });
        pickerButton.setAttribute('aria-label',
            pickerType === 'date' ? 'Open date picker' : 'Open time picker');
        setIcon(pickerButton, pickerType === 'date' ? 'calendar' : 'clock');

        // Hidden native picker input — pointer-events: auto (CSS) so iPad users
        // can directly tap to open the native picker (WebKit Bug #261703).
        const nativePickerInput = wrapper.createEl('input', {
            cls: 'create-task-modal__native-picker-input'
        });
        nativePickerInput.type = pickerType;
        nativePickerInput.setAttribute('aria-hidden', 'true');
        if (pickerType === 'time') {
            nativePickerInput.step = '60';
        }

        // On click, try showPicker() for desktop browsers that need it.
        // On iPad, the direct tap on the native input already opens the picker.
        nativePickerInput.addEventListener('click', () => {
            try {
                nativePickerInput.showPicker();
            } catch {
                // iOS Safari: direct tap already opens native picker
            }
        });

        // Fallback: clicking the visual icon area behind the native input
        pickerButton.addEventListener('click', () => {
            try {
                nativePickerInput.showPicker();
            } catch {
                nativePickerInput.focus();
                nativePickerInput.click();
            }
        });

        const textInput = wrapper.createEl('input', {
            type: 'text',
            placeholder,
            cls: 'create-task-modal__text-input'
        });
        textInput.value = initialValue;

        // Clear button (right side, visible only when value exists)
        const clearButton = wrapper.createDiv({
            cls: 'create-task-modal__clear-button'
        });
        clearButton.setAttribute('aria-label', 'Clear');
        setIcon(clearButton, 'x');
        clearButton.style.display = initialValue ? '' : 'none';
        clearButton.addEventListener('click', () => {
            textInput.value = '';
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
            clearButton.style.display = 'none';
        });

        // Sync text input value → native input before picker opens
        const syncNativeValueFromText = () => {
            const value = textInput.value.trim();
            if (pickerType === 'date') {
                nativePickerInput.value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
                return;
            }
            nativePickerInput.value = /^\d{2}:\d{2}$/.test(value) ? value : '';
        };

        // Keep native input in sync when text changes; toggle clear button visibility
        textInput.addEventListener('input', () => {
            syncNativeValueFromText();
            clearButton.style.display = textInput.value.trim() ? '' : 'none';
        });

        // Sync before the picker opens (focus = about to show picker on some platforms)
        nativePickerInput.addEventListener('focus', syncNativeValueFromText);

        // When the user picks a value from the native picker, update the text input
        nativePickerInput.addEventListener('change', () => {
            if (!nativePickerInput.value) {
                return;
            }
            textInput.value = nativePickerInput.value;
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
        });

        return textInput;
    }

    private validateInputs(): boolean {
        const inputs = [
            this.startDateInput, this.startTimeInput,
            this.endDateInput, this.endTimeInput,
            this.dueDateInput, this.dueTimeInput
        ];
        inputs.forEach(el => el?.classList.remove('create-task-modal__input--invalid'));
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

        if (this.lastDisplayTask) {
            const rangeErr = validateDateRange(this.lastDisplayTask);
            if (rangeErr) return this.applyValidationError(rangeErr);
        }

        // Warning: empty task won't appear in viewer
        const { startDate: sd, startTime: st, endDate: ed, endTime: et, dueDate: dd, dueTime: dt } = fields;
        if (this.options.warnOnEmptyTask && !this.result.content.trim() && !sd && !st && !ed && !et && !dd && !dt) {
            this.warningEl.setText('Task name and date are both empty — this task will not appear in the viewer.');
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
        inputMap[err.field]?.classList.add('create-task-modal__input--invalid');
        this.showError(err.message);
        return false;
    }

    private showError(message: string) {
        this.errorEl.setText(message);
        this.errorEl.style.display = 'block';
    }

    /**
     * Recalculate all implicit placeholders based on current result values.
     * Builds a partial Task from the form state and runs it through toDisplayTask()
     * to get the same implicit resolution used everywhere else.
     */
    private updatePlaceholders(): void {
        const startHour = this.options.startHour ?? 0;

        // Build a partial Task from current form values
        const formTask: Task = {
            id: 'placeholder-temp',
            file: '',
            line: 0,
            indent: 0,
            content: '',
            statusChar: ' ',
            childIds: [],
            childLines: [],
            startDate: this.result.startDate || this.options.dailyNoteDate,
            startTime: this.result.startTime,
            endDate: this.result.endDate,
            endTime: this.result.endTime,
            commands: [],
            originalText: '',
            childLineBodyOffsets: [],
            tags: [],
            parserId: 'at-notation',
            properties: {},
        };

        const dt = toDisplayTask(formTask, startHour);
        this.lastDisplayTask = dt;

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

    private static readonly BRACKET_PAIRS: Record<string, string> = { '[': ']', '(': ')' };

    private handleBracketPairing(e: KeyboardEvent): void {
        const input = this.nameInput;
        const start = input.selectionStart!;
        const end = input.selectionEnd!;
        const val = input.value;

        // Opening bracket: insert pair
        const closing = CreateTaskModal.BRACKET_PAIRS[e.key];
        if (closing) {
            e.preventDefault();
            const newVal = val.slice(0, start) + e.key + val.slice(start, end) + closing + val.slice(end);
            input.value = newVal;
            input.setSelectionRange(start + 1, end + 1);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        // Closing bracket: skip over if next char matches
        if (e.key === ']' || e.key === ')') {
            if (val[start] === e.key && start === end) {
                e.preventDefault();
                input.setSelectionRange(start + 1, start + 1);
                return;
            }
        }

        // Backspace: delete pair if cursor is between empty brackets
        if (e.key === 'Backspace' && start === end && start > 0) {
            const before = val[start - 1];
            const after = val[start];
            if ((before === '[' && after === ']') || (before === '(' && after === ')')) {
                e.preventDefault();
                input.value = val.slice(0, start - 1) + val.slice(start + 1);
                input.setSelectionRange(start - 1, start - 1);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
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
