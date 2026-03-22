import { DateUtils } from '../utils/DateUtils';

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
}

export interface EffectiveDateFields {
    effectiveStartDate?: string;
    effectiveStartTime?: string;
    effectiveEndDate?: string;
    effectiveEndTime?: string;
}

export interface DateValidationError {
    field: 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'dueDate' | 'dueTime';
    message: string;
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
            return { field: c.field, message: `${c.label}: invalid ${c.type} format (${c.type === 'date' ? 'YYYY-MM-DD' : 'HH:mm'}).` };
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
        return { field: 'startTime', message: 'Start: date is required when time is specified.' };
    }
    if (!ed && et && !sd && !ctx.hasImplicitStartDate) {
        return { field: 'endTime', message: 'End: date is required when there is no start date.' };
    }
    if (!dd && dt) {
        return { field: 'dueTime', message: 'Due: date is required when time is specified.' };
    }
    return null;
}

/**
 * Range check: end must not be before start (using DisplayTask resolved values).
 */
export function validateDateRange(effective: EffectiveDateFields): DateValidationError | null {
    const { effectiveStartDate: esd, effectiveStartTime: est, effectiveEndDate: eed, effectiveEndTime: eet } = effective;
    if (esd && eed) {
        if (eed < esd) {
            return { field: 'endDate', message: 'End date must not be before start date.' };
        }
        if (eed === esd && est && eet && eet <= est) {
            return { field: 'endTime', message: 'End time must be after start time on the same day.' };
        }
    }
    return null;
}
