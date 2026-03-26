import { DateUtils } from '../utils/DateUtils';
import { t } from '../i18n';
import { validateDateTimeRules } from '../services/parsing/utils/DateTimeRuleValidator';

export interface DateTimeFields {
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    dueDate: string;
    dueTime: string;
}

export interface ValidationContext {
    hasImplicitStartDate?: boolean;
    /** 暗黙の startDate（daily note 継承等） */
    implicitStartDate?: string;
}

export interface DateValidationError {
    field: 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'dueDate' | 'dueTime';
    message: string;
    hint?: string;
}

/**
 * Validate date/time format strings.
 * Empty values are OK; non-empty values must match YYYY-MM-DD or HH:mm.
 */
export function validateDateTimeFormats(fields: DateTimeFields): DateValidationError | null {
    const checks: Array<{ value: string; field: DateValidationError['field']; label: string; type: 'date' | 'time' }> = [
        { value: fields.startDate, field: 'startDate', label: 'Start', type: 'date' },
        { value: fields.startTime, field: 'startTime', label: 'Start', type: 'time' },
        { value: fields.endDate, field: 'endDate', label: 'End', type: 'date' },
        { value: fields.endTime, field: 'endTime', label: 'End', type: 'time' },
        { value: fields.dueDate, field: 'dueDate', label: 'Due', type: 'date' },
        { value: fields.dueTime, field: 'dueTime', label: 'Due', type: 'time' },
    ];
    for (const c of checks) {
        if (!c.value) continue;
        const valid = c.type === 'date' ? DateUtils.isValidDateString(c.value) : DateUtils.isValidTimeString(c.value);
        if (!valid) {
            const label = t(`modal.${c.label.toLowerCase()}`);
            const expected = c.type === 'date' ? 'YYYY-MM-DD' : 'HH:mm';
            return { field: c.field, message: t('validation.invalidFormat', { label, type: c.type, expected }) };
        }
    }
    return null;
}

/**
 * Business rules: time-only input requires a date.
 */
export function validateDateRequirements(fields: DateTimeFields, ctx: ValidationContext = {}): DateValidationError | null {
    const { startDate: sd, startTime: st, endDate: ed, endTime: et, dueDate: dd, dueTime: dt } = fields;
    if (!sd && st && !ctx.hasImplicitStartDate) {
        return { field: 'startTime', message: t('validation.startRequiresDate') };
    }
    if (!ed && et && !sd && !ctx.hasImplicitStartDate) {
        return { field: 'endTime', message: t('validation.endRequiresDate') };
    }
    if (!dd && dt) {
        return { field: 'dueTime', message: t('validation.dueRequiresDate') };
    }
    return null;
}

/**
 * Range check using shared validation rules (raw values, not effective values).
 * Cross-midnight, same-day inversion, end-before-start are all handled by the shared rules.
 */
export function validateDateRange(fields: DateTimeFields, ctx: ValidationContext = {}): DateValidationError | null {
    const due = fields.dueDate
        ? (fields.dueTime ? `${fields.dueDate}T${fields.dueTime}` : fields.dueDate)
        : undefined;

    const result = validateDateTimeRules({
        startDate: fields.startDate || undefined,
        startTime: fields.startTime || undefined,
        endDate: fields.endDate || undefined,
        endTime: fields.endTime || undefined,
        due,
        endDateImplicit: !fields.endDate,
        implicitStartDate: ctx.implicitStartDate,
    });
    if (!result) return null;

    const field: DateValidationError['field'] =
        result.rule === 'end-time-without-start' ? 'endTime'
        : result.rule === 'due-without-date' ? 'dueDate'
        : 'endDate';
    return { field, message: result.message, hint: result.hint };
}
