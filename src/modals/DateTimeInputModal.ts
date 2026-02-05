import { App, Modal, Setting } from 'obsidian';

export type DateTimeType = 'start' | 'end' | 'deadline';

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
        contentEl.createEl('h3', { text: `Edit ${typeLabel}` });

        // Date + Time inputs in a horizontal row
        const row = contentEl.createDiv('datetime-input-modal__row');

        const dateContainer = row.createDiv('datetime-input-modal__field');
        const dateLabel = this.type === 'end' && this.options.hasStartDate
            ? 'Date (optional)'
            : 'Date';
        dateContainer.createEl('label', { text: dateLabel });
        this.dateInput = dateContainer.createEl('input', {
            type: 'text',
            placeholder: 'YYYY-MM-DD',
            cls: 'datetime-input-modal__text-input'
        });
        this.dateInput.value = this.currentValue.date || '';
        this.dateInput.addEventListener('input', () => this.validateInputs());

        const timeContainer = row.createDiv('datetime-input-modal__field');
        timeContainer.createEl('label', { text: 'Time' });
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
                .setButtonText('Clear')
                .setWarning()
                .onClick(() => {
                    this.onSubmit({ date: null, time: null });
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('OK')
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

        // Format validation
        if (dateValue && !this.isValidDate(dateValue)) {
            this.dateInput.addClass('datetime-input-modal__input--invalid');
            this.showError('Invalid date format. Use YYYY-MM-DD.');
            return { valid: false, errorMessage: 'Invalid date format' };
        }

        if (timeValue && !this.isValidTime(timeValue)) {
            this.timeInput.addClass('datetime-input-modal__input--invalid');
            this.showError('Invalid time format. Use HH:mm (00:00-23:59).');
            return { valid: false, errorMessage: 'Invalid time format' };
        }

        // Business rule validation based on type
        switch (this.type) {
            case 'start':
                if (!dateValue && timeValue) {
                    this.timeInput.addClass('datetime-input-modal__input--invalid');
                    this.showError('Start requires a date if time is specified.');
                    return { valid: false, errorMessage: 'Start requires date' };
                }
                break;

            case 'end':
                if (!dateValue && timeValue && !this.options.hasStartDate) {
                    this.timeInput.addClass('datetime-input-modal__input--invalid');
                    this.showError('End time-only requires task to have a start date.');
                    return { valid: false, errorMessage: 'End time-only requires start date' };
                }
                break;

            case 'deadline':
                if (!dateValue && timeValue) {
                    this.timeInput.addClass('datetime-input-modal__input--invalid');
                    this.showError('Deadline requires a date if time is specified.');
                    return { valid: false, errorMessage: 'Deadline requires date' };
                }
                break;
        }

        return { valid: true, errorMessage: '' };
    }

    private showError(message: string) {
        this.errorEl.setText(message);
        this.errorEl.style.display = 'block';
    }

    private isValidDate(value: string): boolean {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(value)) return false;
        const date = new Date(value);
        return !isNaN(date.getTime());
    }

    private isValidTime(value: string): boolean {
        const regex = /^\d{2}:\d{2}$/;
        if (!regex.test(value)) return false;
        const [h, m] = value.split(':').map(Number);
        return h >= 0 && h <= 23 && m >= 0 && m <= 59;
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
