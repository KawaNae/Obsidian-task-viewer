import { App, Modal, Setting } from 'obsidian';

export type DateTimeType = 'start' | 'end' | 'deadline';

export interface DateTimeValue {
    date: string | null;     // YYYY-MM-DD or null
    time: string | null;     // HH:mm or null
    isFuture?: boolean;      // Only for 'start' type
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
    private futureCheckbox: HTMLInputElement | null = null;
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

        // Future checkbox (Start only)
        if (this.type === 'start') {
            const futureContainer = contentEl.createDiv('datetime-input-modal__future');
            const label = futureContainer.createEl('label');
            this.futureCheckbox = label.createEl('input', { type: 'checkbox' });
            this.futureCheckbox.checked = this.currentValue.isFuture || false;
            label.appendText(' Future (no specific date)');

            this.futureCheckbox.addEventListener('change', () => {
                const isFuture = this.futureCheckbox!.checked;
                this.dateInput.disabled = isFuture;
                this.timeInput.disabled = isFuture;
                if (isFuture) {
                    this.dateInput.value = '';
                    this.timeInput.value = '';
                }
                this.validateInputs();
            });
        }

        // Date input (text)
        const dateContainer = contentEl.createDiv('datetime-input-modal__field');
        const dateLabel = this.type === 'end' && this.options.hasStartDate
            ? 'Date (optional if time-only)'
            : 'Date';
        dateContainer.createEl('label', { text: dateLabel });
        this.dateInput = dateContainer.createEl('input', {
            type: 'text',
            placeholder: 'YYYY-MM-DD',
            cls: 'datetime-input-modal__text-input'
        });
        this.dateInput.value = this.currentValue.date || '';
        if (this.currentValue.isFuture) {
            this.dateInput.disabled = true;
        }
        this.dateInput.addEventListener('input', () => this.validateInputs());

        // Time input (text)
        const timeContainer = contentEl.createDiv('datetime-input-modal__field');
        timeContainer.createEl('label', { text: 'Time (optional)' });
        this.timeInput = timeContainer.createEl('input', {
            type: 'text',
            placeholder: 'HH:mm',
            cls: 'datetime-input-modal__text-input'
        });
        this.timeInput.value = this.currentValue.time || '';
        if (this.currentValue.isFuture) {
            this.timeInput.disabled = true;
        }
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
                    this.onSubmit({ date: null, time: null, isFuture: false });
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
        const isFuture = this.futureCheckbox?.checked || false;
        const dateValue = this.dateInput.value.trim();
        const timeValue = this.timeInput.value.trim();

        // Reset styles
        this.dateInput.removeClass('datetime-input-modal__input--invalid');
        this.timeInput.removeClass('datetime-input-modal__input--invalid');
        this.errorEl.style.display = 'none';

        // If future is checked (Start only), no validation needed
        if (isFuture) {
            return { valid: true, errorMessage: '' };
        }

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
                // Start: 日付のみ, 日付+時刻, Future, 空(Clear) のみ許可
                // 時刻のみは不可
                if (!dateValue && timeValue) {
                    this.timeInput.addClass('datetime-input-modal__input--invalid');
                    this.showError('Start requires a date if time is specified.');
                    return { valid: false, errorMessage: 'Start requires date' };
                }
                break;

            case 'end':
                // End: 日付のみ, 日付+時刻, 時刻のみ(startDateがある場合), 空(Clear)
                if (!dateValue && timeValue && !this.options.hasStartDate) {
                    this.timeInput.addClass('datetime-input-modal__input--invalid');
                    this.showError('End time-only requires task to have a start date.');
                    return { valid: false, errorMessage: 'End time-only requires start date' };
                }
                break;

            case 'deadline':
                // Deadline: 日付のみ, 日付+時刻, 空(Clear)
                // 時刻のみは不可
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

        const isFuture = this.futureCheckbox?.checked || false;
        const date = this.dateInput.value.trim() || null;
        const time = this.timeInput.value.trim() || null;

        this.onSubmit({
            date: isFuture ? null : date,
            time: isFuture ? null : time,
            isFuture: this.type === 'start' ? isFuture : undefined
        });
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
