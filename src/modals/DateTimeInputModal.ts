import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import { validateDateTimeFormats, validateDateRequirements, type DateTimeFields } from '../utils/TaskDateValidator';

export type DateTimeType = 'start' | 'end' | 'due';

export interface DateTimeValue {
    date: string | null;     // YYYY-MM-DD or null
    time: string | null;     // HH:mm or null
}

export interface DateTimeModalOptions {
    hasStartDate?: boolean;  // For 'end' type: whether task has a startDate (allows time-only)
}

export class DateTimeInputModal extends Modal {
    private type: DateTimeType;
    private currentValue: DateTimeValue;
    private onSubmit: (value: DateTimeValue) => void;
    private options: DateTimeModalOptions;

    private dateInput: HTMLInputElement;
    private timeInput: HTMLInputElement;
    private errorEl: HTMLElement;

    constructor(
        app: App,
        type: DateTimeType,
        currentValue: DateTimeValue,
        onSubmit: (value: DateTimeValue) => void,
        options: DateTimeModalOptions = {}
    ) {
        super(app);
        this.type = type;
        this.currentValue = currentValue;
        this.onSubmit = onSubmit;
        this.options = options;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('datetime-input-modal');

        // Title
        const typeLabel = this.type.charAt(0).toUpperCase() + this.type.slice(1);
        contentEl.createEl('h3', { text: t('modal.editType', { type: typeLabel }) });

        // Date + Time inputs in a horizontal row
        const row = contentEl.createDiv('datetime-input-modal__row');

        const dateContainer = row.createDiv('datetime-input-modal__field');
        const dateLabel = this.type === 'end' && this.options.hasStartDate
            ? t('modal.dateOptional')
            : t('modal.date');
        dateContainer.createEl('label', { text: dateLabel });
        this.dateInput = dateContainer.createEl('input', {
            type: 'text',
            placeholder: 'YYYY-MM-DD',
            cls: 'datetime-input-modal__text-input'
        });
        this.dateInput.value = this.currentValue.date || '';
        this.dateInput.addEventListener('input', () => this.validateInputs());

        const timeContainer = row.createDiv('datetime-input-modal__field');
        timeContainer.createEl('label', { text: t('modal.time') });
        this.timeInput = timeContainer.createEl('input', {
            type: 'text',
            placeholder: 'HH:mm',
            cls: 'datetime-input-modal__text-input'
        });
        this.timeInput.value = this.currentValue.time || '';
        this.timeInput.addEventListener('input', () => this.validateInputs());

        // Error message
        this.errorEl = contentEl.createDiv('datetime-input-modal__error');
        this.errorEl.style.display = 'none';

        // Buttons
        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t('modal.clear'))
                .setWarning()
                .onClick(() => {
                    this.onSubmit({ date: null, time: null });
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText(t('modal.cancel'))
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText(t('modal.ok'))
                .setCta()
                .onClick(() => this.submit()));

        // Focus on date input
        this.dateInput.focus();

        // Handle Enter key
        this.dateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.submit();
        });
        this.timeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.submit();
        });
    }

    private validateInputs(): { valid: boolean; errorMessage: string } {
        const dateValue = this.dateInput.value.trim();
        const timeValue = this.timeInput.value.trim();

        // Reset styles
        this.dateInput.removeClass('datetime-input-modal__input--invalid');
        this.timeInput.removeClass('datetime-input-modal__input--invalid');
        this.errorEl.style.display = 'none';

        // Build fields for the target type only
        const fields: DateTimeFields = {
            startDate: '', startTime: '', endDate: '', endTime: '', dueDate: '', dueTime: '',
        };
        fields[`${this.type}Date` as keyof DateTimeFields] = dateValue;
        fields[`${this.type}Time` as keyof DateTimeFields] = timeValue;

        // hasStartDate → end time-only is allowed (simulate startDate present)
        if (this.type === 'end' && this.options.hasStartDate) {
            fields.startDate = 'implicit';
        }

        const formatErr = validateDateTimeFormats(fields);
        if (formatErr) {
            const input = formatErr.field.endsWith('Date') ? this.dateInput : this.timeInput;
            input.addClass('datetime-input-modal__input--invalid');
            this.showError(formatErr.message);
            return { valid: false, errorMessage: formatErr.message };
        }

        const reqErr = validateDateRequirements(fields);
        if (reqErr) {
            const input = reqErr.field.endsWith('Date') ? this.dateInput : this.timeInput;
            input.addClass('datetime-input-modal__input--invalid');
            this.showError(reqErr.message);
            return { valid: false, errorMessage: reqErr.message };
        }

        return { valid: true, errorMessage: '' };
    }

    private showError(message: string) {
        this.errorEl.setText(message);
        this.errorEl.style.display = 'block';
    }

    private submit() {
        const result = this.validateInputs();
        if (!result.valid) {
            return;
        }

        const date = this.dateInput.value.trim() || null;
        const time = this.timeInput.value.trim() || null;

        this.onSubmit({ date, time });
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
