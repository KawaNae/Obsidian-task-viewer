import { App, Modal, Setting } from 'obsidian';
import { Task } from '../types';
import { TaskParser } from '../services/parsing/TaskParser';

export interface CreateTaskResult {
    content: string;
    startDate?: string;   // YYYY-MM-DD
    startTime?: string;   // HH:mm
    endDate?: string;     // YYYY-MM-DD
    endTime?: string;     // HH:mm
    deadline?: string;    // YYYY-MM-DD or YYYY-MM-DDThh:mm
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
        deadline: result.deadline,
        explicitStartDate: !!result.startDate,
        explicitStartTime: !!result.startTime,
        explicitEndDate: !!result.endDate,
        explicitEndTime: !!result.endTime,
        commands: [],
        originalText: '',
        childLineBodyOffsets: [],
        parserId: 'at-notation'
    };
    return TaskParser.format(task);
}

export interface CreateTaskModalOptions {
    /** Show a warning when task name and all date fields are empty (task won't appear in viewer) */
    warnOnEmptyTask?: boolean;
}

export class CreateTaskModal extends Modal {
    private result: CreateTaskResult;
    private onSubmit: (result: CreateTaskResult) => void;
    private options: CreateTaskModalOptions;

    private startDateInput: HTMLInputElement;
    private startTimeInput: HTMLInputElement;
    private endDateInput: HTMLInputElement;
    private endTimeInput: HTMLInputElement;
    private deadlineDateInput: HTMLInputElement;
    private deadlineTimeInput: HTMLInputElement;
    private errorEl: HTMLElement;
    private warningEl: HTMLElement;

    constructor(app: App, onSubmit: (result: CreateTaskResult) => void, initialValues: Partial<CreateTaskResult> = {}, options: CreateTaskModalOptions = {}) {
        super(app);
        this.onSubmit = onSubmit;
        this.result = { content: '', ...initialValues };
        this.options = options;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h2', { text: 'Create New Task' });

        // --- Task Name ---
        new Setting(contentEl)
            .setName('Task Name')
            .addText((text) => {
                text.onChange((value) => {
                    this.result.content = value;
                    this.validateInputs();
                });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') this.submit();
                });
            });

        // --- Start ---
        this.renderDateTimeSection(
            contentEl, 'Start',
            this.result.startDate, this.result.startTime,
            'start'
        );

        // --- End ---
        this.renderDateTimeSection(
            contentEl, 'End',
            this.result.endDate, this.result.endTime,
            'end'
        );

        // --- Deadline ---
        // Deadline is stored as a single string (YYYY-MM-DD or YYYY-MM-DDThh:mm); split for inputs
        const dlParts = this.splitDeadline(this.result.deadline);
        this.renderDateTimeSection(
            contentEl, 'Deadline',
            dlParts.date, dlParts.time,
            'deadline'
        );

        // --- Error / Warning display ---
        this.errorEl = contentEl.createDiv({ cls: 'create-task-modal__error' });
        this.errorEl.style.display = 'none';
        this.warningEl = contentEl.createDiv({ cls: 'create-task-modal__warning' });
        this.warningEl.style.display = 'none';

        // --- Create button ---
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText('Create')
                    .setCta()
                    .onClick(() => this.submit()));

        // Focus on task name input
        setTimeout(() => {
            const input = contentEl.querySelector('input[type="text"]') as HTMLInputElement;
            if (input) input.focus();
        }, 50);
    }

    private renderDateTimeSection(
        container: HTMLElement,
        label: string,
        initialDate: string | undefined,
        initialTime: string | undefined,
        section: 'start' | 'end' | 'deadline'
    ) {
        container.createEl('h4', { text: label, cls: 'create-task-modal__section-label' });

        const row = container.createDiv({ cls: 'create-task-modal__date-row' });

        // Date field
        const dateDiv = row.createDiv({ cls: 'create-task-modal__date-row__field' });
        dateDiv.createEl('label', { text: 'Date' });
        const dateInput = dateDiv.createEl('input', {
            type: 'text',
            placeholder: 'YYYY-MM-DD',
            cls: 'create-task-modal__text-input'
        });
        dateInput.value = initialDate || '';

        // Time field
        const timeDiv = row.createDiv({ cls: 'create-task-modal__date-row__field' });
        timeDiv.createEl('label', { text: 'Time' });
        const timeInput = timeDiv.createEl('input', {
            type: 'text',
            placeholder: 'HH:mm',
            cls: 'create-task-modal__text-input'
        });
        timeInput.value = initialTime || '';

        // Store refs
        if (section === 'start') { this.startDateInput = dateInput; this.startTimeInput = timeInput; }
        else if (section === 'end') { this.endDateInput = dateInput; this.endTimeInput = timeInput; }
        else { this.deadlineDateInput = dateInput; this.deadlineTimeInput = timeInput; }

        // Event listeners: update result and validate
        const update = () => {
            const d = dateInput.value.trim() || undefined;
            const t = timeInput.value.trim() || undefined;

            if (section === 'start') { this.result.startDate = d; this.result.startTime = t; }
            else if (section === 'end') { this.result.endDate = d; this.result.endTime = t; }
            else { this.result.deadline = d ? (t ? `${d}T${t}` : d) : undefined; }

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
            this.deadlineDateInput, this.deadlineTimeInput
        ];
        inputs.forEach(el => el?.classList.remove('create-task-modal__input--invalid'));
        this.errorEl.style.display = 'none';

        const isValidDate = (v: string): boolean => {
            if (!v) return true;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
            return !isNaN(new Date(v).getTime());
        };
        const isValidTime = (v: string): boolean => {
            if (!v) return true;
            if (!/^\d{2}:\d{2}$/.test(v)) return false;
            const [h, m] = v.split(':').map(Number);
            return h >= 0 && h <= 23 && m >= 0 && m <= 59;
        };

        const sd = this.startDateInput?.value.trim() || '';
        const st = this.startTimeInput?.value.trim() || '';
        const ed = this.endDateInput?.value.trim() || '';
        const et = this.endTimeInput?.value.trim() || '';
        const dd = this.deadlineDateInput?.value.trim() || '';
        const dt = this.deadlineTimeInput?.value.trim() || '';

        // Format checks
        if (!isValidDate(sd)) { this.startDateInput.classList.add('create-task-modal__input--invalid'); this.showError('Start: invalid date format (YYYY-MM-DD).'); return false; }
        if (!isValidTime(st)) { this.startTimeInput.classList.add('create-task-modal__input--invalid'); this.showError('Start: invalid time format (HH:mm).'); return false; }
        if (!isValidDate(ed)) { this.endDateInput.classList.add('create-task-modal__input--invalid'); this.showError('End: invalid date format (YYYY-MM-DD).'); return false; }
        if (!isValidTime(et)) { this.endTimeInput.classList.add('create-task-modal__input--invalid'); this.showError('End: invalid time format (HH:mm).'); return false; }
        if (!isValidDate(dd)) { this.deadlineDateInput.classList.add('create-task-modal__input--invalid'); this.showError('Deadline: invalid date format (YYYY-MM-DD).'); return false; }
        if (!isValidTime(dt)) { this.deadlineTimeInput.classList.add('create-task-modal__input--invalid'); this.showError('Deadline: invalid time format (HH:mm).'); return false; }

        // Business rules
        if (!sd && st) { this.startTimeInput.classList.add('create-task-modal__input--invalid'); this.showError('Start: date is required when time is specified.'); return false; }
        if (!ed && et && !sd) { this.endTimeInput.classList.add('create-task-modal__input--invalid'); this.showError('End: date is required when there is no start date.'); return false; }
        if (!dd && dt) { this.deadlineTimeInput.classList.add('create-task-modal__input--invalid'); this.showError('Deadline: date is required when time is specified.'); return false; }

        // Warning: empty task won't appear in viewer
        if (this.options.warnOnEmptyTask && !this.result.content.trim() && !sd && !st && !ed && !et && !dd && !dt) {
            this.warningEl.setText('Task name and date are both empty — this task will not appear in the viewer.');
            this.warningEl.style.display = 'block';
        } else {
            this.warningEl.style.display = 'none';
        }

        return true;
    }

    private showError(message: string) {
        this.errorEl.setText(message);
        this.errorEl.style.display = 'block';
    }

    /** Split a deadline string ("YYYY-MM-DD" or "YYYY-MM-DDThh:mm") into date and time parts */
    private splitDeadline(deadline: string | undefined): { date: string | undefined; time: string | undefined } {
        if (!deadline) return { date: undefined, time: undefined };
        if (deadline.includes('T')) {
            const [date, time] = deadline.split('T');
            return { date, time };
        }
        return { date: deadline, time: undefined };
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
