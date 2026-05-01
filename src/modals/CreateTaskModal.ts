import { App, Modal, Setting, setIcon } from 'obsidian';
import { t } from '../i18n';
import { DisplayTask, Task } from '../types';
import { TaskParser } from '../services/parsing/TaskParser';
import { NO_TASK_LOOKUP, toDisplayTask } from '../services/display/DisplayTaskConverter';
import { createTempTask } from '../services/data/createTempTask';
import { validateDateTimeFormats, validateDateRequirements, validateDateRange, type DateValidationError } from './TaskDateValidator';
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

    private isComposingName = false;
    private lastValueBeforeInput = '';
    private lastSelectionBeforeInput = 0;


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
        this.nameInput.addEventListener('compositionstart', () => {
            this.isComposingName = true;
        });
        this.nameInput.addEventListener('compositionend', () => {
            this.isComposingName = false;
            // The composition-commit 'input' event has already fired (with
            // isComposing=true, so the listener below skipped pairing). Run
            // pairing reactively against the snapshot taken in 'beforeinput'.
            this.applyBracketPairingReactive();
            this.result.content = this.nameInput.value;
            this.validateInputs();
        });
        this.nameInput.addEventListener('beforeinput', () => {
            // Snapshot so the following 'input' event (or 'compositionend') can diff.
            this.lastValueBeforeInput = this.nameInput.value;
            this.lastSelectionBeforeInput = this.nameInput.selectionStart ?? 0;
        });
        this.nameInput.addEventListener('input', (e: Event) => {
            const ie = e as InputEvent;
            if (!this.isComposingName && !ie.isComposing) {
                this.applyBracketPairingReactive();
            }
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
        dateDiv.createEl('label', { text: t('modal.date') });
        const dateInput = this.createPickerTextInput(
            dateDiv,
            'date',
            'YYYY-MM-DD',
            initialDate || ''
        );

        // Time field (placeholder set later by updatePlaceholders())
        const timeDiv = row.createDiv({ cls: 'create-task-modal__date-row__field' });
        timeDiv.createEl('label', { text: t('modal.time') });
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
            pickerType === 'date' ? t('modal.openDatePicker') : t('modal.openTimePicker'));
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
        inputMap[err.field]?.classList.add('create-task-modal__input--invalid');
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

    private static readonly BRACKET_PAIRS: Record<string, string> = {
        '(': ')', '[': ']',
        '（': '）', '［': '］',
        '「': '」', '『': '』', '【': '】',
        '｛': '｝', '〈': '〉', '《': '》',
    };

    private static readonly BRACKET_CLOSERS: Set<string> = new Set(
        Object.values(CreateTaskModal.BRACKET_PAIRS)
    );

    // Post-insertion reactive pairing. Runs after the browser (or IME) has
    // already applied the user's edit; diffs against the snapshot taken in
    // 'beforeinput'. This avoids 'beforeinput.preventDefault()' which is
    // unreliable for IME input on iOS WebKit.
    private applyBracketPairingReactive(): void {
        const input = this.nameInput;
        const newVal = input.value;
        const newPos = input.selectionStart ?? 0;
        const oldVal = this.lastValueBeforeInput;
        const oldPos = this.lastSelectionBeforeInput;

        // Case 1: exactly one character was inserted at the caret.
        if (newVal.length === oldVal.length + 1 && newPos === oldPos + 1) {
            const ch = newVal[oldPos];

            // Opening bracket: insert closing partner unless it's already there.
            const closing = CreateTaskModal.BRACKET_PAIRS[ch];
            if (closing) {
                if (newVal[newPos] === closing) return;
                input.value = newVal.slice(0, newPos) + closing + newVal.slice(newPos);
                input.setSelectionRange(newPos, newPos);
                return;
            }

            // Closing bracket skip-over: if a matching closer was already at
            // this position before the user typed, drop the duplicate and
            // leave the caret past the pre-existing closer.
            if (CreateTaskModal.BRACKET_CLOSERS.has(ch) && oldVal[oldPos] === ch) {
                input.value = newVal.slice(0, newPos) + newVal.slice(newPos + 1);
                input.setSelectionRange(newPos, newPos);
                return;
            }
            return;
        }

        // Case 2: exactly one character was deleted at the caret (backspace).
        // If we deleted the opener of an empty pair, also remove the closer.
        if (newVal.length === oldVal.length - 1 && newPos === oldPos - 1) {
            const deletedChar = oldVal[oldPos - 1];
            const nextChar = oldVal[oldPos];
            const closing = deletedChar ? CreateTaskModal.BRACKET_PAIRS[deletedChar] : undefined;
            if (closing && nextChar === closing) {
                input.value = newVal.slice(0, newPos) + newVal.slice(newPos + 1);
                input.setSelectionRange(newPos, newPos);
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
