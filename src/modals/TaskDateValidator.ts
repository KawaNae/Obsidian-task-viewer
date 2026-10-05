import { DateUtils } from '../utils/DateUtils';
import { t } from '../i18n';
import type { FormIssue } from './form/FormIssue';
import { validateDateTimeRules } from '../services/parsing/utils/DateTimeRuleValidator';

/** The six date and time inputs of a task form, as typed. The due's two are joined by {@link DateUtils.joinDateTime}. */
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
    field: keyof DateTimeFields;
    message: string;
    hint?: string;
}

/**
 * The rules across a task's date fields (a time needs a date, an end comes
 * after its start), checked on values each field has read: the one rule
 * broken first, as the error of the field it is of, with its hint on a line
 * of its own; none when they hold.
 */
export function dateRuleIssues(fields: DateTimeFields, ctx: ValidationContext = {}): FormIssue<keyof DateTimeFields>[] {
    const err = validateDateRequirements(fields, ctx) ?? validateDateRange(fields, ctx);
    if (!err) return [];
    return [{ at: err.field, tone: 'error', text: err.hint ? `${err.message}\n${err.hint}` : err.message }];
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
    const due = DateUtils.joinDateTime(fields.dueDate, fields.dueTime);

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
