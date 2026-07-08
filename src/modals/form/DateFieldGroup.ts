import { t } from '../../i18n';
import type { Task } from '../../types';
import { toDisplayTask } from '../../services/display/DisplayTaskConverter';
import {
    validateDateTimeFormats, validateDateRequirements, validateDateRange,
    type DateValidationError,
} from '../TaskDateValidator';
import { createPickerTextField } from './PickerTextField';
import { createFormRow } from './formRow';

export type DateGroupKey = 'start' | 'end' | 'due';
export type DateFieldKey = 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'dueDate' | 'dueTime';

export interface DateFieldValues {
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    dueDate: string;
    dueTime: string;
}

export interface DateFieldGroupOptions {
    labels: { start: string; end: string; due: string };
    initial: Partial<DateFieldValues>;
    buildOverlayTask: (f: DateFieldValues) => Task;
    getStartHour: () => number;
    taskLookup: (id: string) => Task | undefined;
    getValidationCtx: () => { hasImplicitStartDate: boolean; implicitStartDate?: string };
    getFallbackDatePlaceholder?: () => string | undefined;
    isSuspended?: () => boolean;
    onInput?: (group: DateGroupKey, f: DateFieldValues) => void;
    onCommit?: (group: DateGroupKey, f: DateFieldValues) => void;
    onEnter?: () => void;
}

/**
 * 6 つの日付/時刻入力（開始/終了/期限 × 日付/時刻）をまとめて所有する
 * フォーム部品。CreateTaskModal と TaskHubForm が共用する。
 *
 * 行文法: ラベル左置き + date:time = 2:1 flex 配分（_form.css）。
 */
export class DateFieldGroup {
    private startDateInput: HTMLInputElement;
    private startTimeInput: HTMLInputElement;
    private endDateInput: HTMLInputElement;
    private endTimeInput: HTMLInputElement;
    private dueDateInput: HTMLInputElement;
    private dueTimeInput: HTMLInputElement;
    private errorEl: HTMLElement | null = null;

    constructor(
        container: HTMLElement,
        private opts: DateFieldGroupOptions,
    ) {
        const start = this.renderRow(container, 'start', opts.labels.start, opts.initial.startDate, opts.initial.startTime);
        this.startDateInput = start.dateInput;
        this.startTimeInput = start.timeInput;

        const end = this.renderRow(container, 'end', opts.labels.end, opts.initial.endDate, opts.initial.endTime);
        this.endDateInput = end.dateInput;
        this.endTimeInput = end.timeInput;

        const due = this.renderRow(container, 'due', opts.labels.due, opts.initial.dueDate, opts.initial.dueTime);
        this.dueDateInput = due.dateInput;
        this.dueTimeInput = due.timeInput;
    }

    private renderRow(
        container: HTMLElement,
        group: DateGroupKey,
        label: string,
        initialDate: string | undefined,
        initialTime: string | undefined,
    ): { dateInput: HTMLInputElement; timeInput: HTMLInputElement } {
        const { row } = createFormRow(container, label, { dates: true });

        const dateField = row.createDiv({ cls: 'tv-form__field tv-form__field--date' });
        const dateInput = createPickerTextField(dateField, 'date', 'YYYY-MM-DD', initialDate || '');
        dateInput.setAttribute('aria-label', `${label} — ${t('modal.date')}`);

        const timeField = row.createDiv({ cls: 'tv-form__field tv-form__field--time' });
        const timeInput = createPickerTextField(timeField, 'time', 'HH:mm', initialTime || '');
        timeInput.setAttribute('aria-label', `${label} — ${t('modal.time')}`);

        for (const input of [dateInput, timeInput]) {
            input.addEventListener('input', (e: Event) => {
                this.opts.onInput?.(group, this.collect());
                this.updatePlaceholders();
                this.validate();
                if (!e.isTrusted && !(this.opts.isSuspended?.() ?? false)) {
                    this.opts.onCommit?.(group, this.collect());
                }
            });
            input.addEventListener('blur', () => {
                this.opts.onCommit?.(group, this.collect());
            });
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    if (this.opts.onEnter) {
                        this.opts.onEnter();
                    } else {
                        this.opts.onCommit?.(group, this.collect());
                    }
                }
            });
        }

        return { dateInput, timeInput };
    }

    bindErrorEl(el: HTMLElement): void {
        this.errorEl = el;
    }

    collect(): DateFieldValues {
        return {
            startDate: this.startDateInput?.value.trim() || '',
            startTime: this.startTimeInput?.value.trim() || '',
            endDate: this.endDateInput?.value.trim() || '',
            endTime: this.endTimeInput?.value.trim() || '',
            dueDate: this.dueDateInput?.value.trim() || '',
            dueTime: this.dueTimeInput?.value.trim() || '',
        };
    }

    validate(): boolean {
        const inputs = [
            this.startDateInput, this.startTimeInput,
            this.endDateInput, this.endTimeInput,
            this.dueDateInput, this.dueTimeInput,
        ];
        inputs.forEach(el => el?.classList.remove('tv-ctrl__text-input--invalid'));
        if (this.errorEl) this.errorEl.style.display = 'none';

        const fields = this.collect();
        const ctx = this.opts.getValidationCtx();

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
        inputMap[err.field]?.classList.add('tv-ctrl__text-input--invalid');
        if (this.errorEl) {
            this.errorEl.empty();
            this.errorEl.setText(err.message);
            if (err.hint) {
                this.errorEl.createEl('br');
                this.errorEl.appendText(err.hint);
            }
            this.errorEl.style.display = 'block';
        }
        return false;
    }

    updatePlaceholders(): void {
        const fields = this.collect();
        const overlay = this.opts.buildOverlayTask(fields);
        const dt = toDisplayTask(overlay, this.opts.getStartHour(), this.opts.taskLookup);
        const fallback = this.opts.getFallbackDatePlaceholder?.() || 'YYYY-MM-DD';

        if (this.startDateInput) {
            this.startDateInput.placeholder =
                (dt.startDateImplicit && dt.effectiveStartDate) || fallback;
        }
        if (this.startTimeInput) {
            this.startTimeInput.placeholder =
                (dt.startTimeImplicit && dt.effectiveStartDate && dt.effectiveStartTime) || 'HH:mm';
        }
        if (this.endDateInput) {
            this.endDateInput.placeholder =
                (dt.endDateImplicit && dt.effectiveEndDate) || fallback;
        }
        if (this.endTimeInput) {
            this.endTimeInput.placeholder =
                (dt.endTimeImplicit && dt.effectiveEndDate && dt.effectiveEndTime) || 'HH:mm';
        }
    }

    getInput(key: DateFieldKey): HTMLInputElement {
        switch (key) {
            case 'startDate': return this.startDateInput;
            case 'startTime': return this.startTimeInput;
            case 'endDate': return this.endDateInput;
            case 'endTime': return this.endTimeInput;
            case 'dueDate': return this.dueDateInput;
            case 'dueTime': return this.dueTimeInput;
        }
    }

    setEnabled(enabled: boolean): void {
        const inputs = [
            this.startDateInput, this.startTimeInput,
            this.endDateInput, this.endTimeInput,
            this.dueDateInput, this.dueTimeInput,
        ];
        for (const i of inputs) { if (i) i.disabled = !enabled; }
    }

    setInputValue(input: HTMLInputElement, value: string, composing = false): void {
        if (document.activeElement === input || composing) return;
        if (input.value === value) return;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    static splitDue(due: string | undefined): { date: string | undefined; time: string | undefined } {
        if (!due) return { date: undefined, time: undefined };
        if (due.includes('T')) {
            const [date, time] = due.split('T');
            return { date, time };
        }
        return { date: due, time: undefined };
    }
}
