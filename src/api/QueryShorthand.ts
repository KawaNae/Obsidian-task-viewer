import type { FilterCondition, DateRangeValue, SingleDateValue } from '../services/filter/FilterTypes';
import { isReversedRange } from '../services/filter/FilterTypes';
import { DATE_PRESET_SYNTAX, parseDatePreset } from '../services/filter/DatePreset';
import { TaskApiError } from './TaskApiTypes';
import type { SimpleFilterParams, WindowParams } from './TaskApiTypes';

/**
 * The entry's shorthand: what a query's params other than `filter` and
 * `filterFile` stand for, as conditions of a FilterState. Each param adds
 * one condition, and the conditions are taken together with `filter` and the
 * filter file (`resolveQuery`): a task answers when it passes all of them.
 *
 *   - `date=X` is `period overlaps X`; `today` is `date=today`
 *   - `from=X to=Y` is `period overlaps { from: X, to: Y }`, open on a side
 *     left out; the range operations' `from` and `to` are the same
 *   - the simple fields (`file`, `status`, `tag`, ...) are their own
 *     conditions; `due` is `due equals`, not a window
 *
 * The one place a param of a query becomes a condition, so a window is
 * judged as the views and the period condition judge it.
 */

/**
 * A date parameter that takes a preset (`due`, `date`, `from`, `to`):
 * a day that exists, with a time or not, or a preset. The one place its
 * error is worded.
 */
export function readDateParam(value: string, name: string): SingleDateValue {
    const read = parseDatePreset(value);
    if (read.ok) return read.value;
    if (read.issue.code === 'noSuchDay') throw TaskApiError.ofIssue(read.issue, name, value);
    throw new TaskApiError(n => `Invalid date value for ${n(name)}: ${value}. Use YYYY-MM-DD, YYYY-MM-DD HH:mm or a preset (${DATE_PRESET_SYNTAX})`, name);
}

/**
 * The conditions the params name, the simple fields first and the window
 * after; none when they name none. A value that cannot be read is an error.
 */
export function shorthandConditions(params: SimpleFilterParams & WindowParams): FilterCondition[] {
    return [...simpleConditions(params), ...windowConditions(params)];
}

/**
 * `today` is `date=today`: a window of its own. Another window beside it
 * (`date`, `from`, `to`) is refused, as `list` refuses `date` beside `from`
 * and `to`: two windows in one call are most likely a slip.
 */
export function refuseWindowOnToday(params: object): void {
    const given = (['date', 'from', 'to'] as const).find(key => (params as Record<string, unknown>)[key] !== undefined);
    if (!given) return;
    const value = String((params as Record<string, unknown>)[given]);
    throw new TaskApiError(n => `Cannot use '${n(given)}' with today, which is ${n('date')}=today; use list ${n(given)}=${value}`, given);
}

function windowConditions(params: WindowParams): FilterCondition[] {
    if (params.date && (params.from || params.to)) {
        throw new TaskApiError(n => `Cannot use '${n('date')}' together with '${n('from')}'/'${n('to')}'. Use either '${n('date')}' for a single-day window, or '${n('from')}'/'${n('to')}' for a range.`, 'date');
    }
    if (params.date) {
        return [{ property: 'period', operator: 'overlaps', value: readDateParam(params.date, 'date') }];
    }
    if (!params.from && !params.to) return [];
    const range: DateRangeValue = {
        ...(params.from ? { from: readDateParam(params.from, 'from') } : {}),
        ...(params.to ? { to: readDateParam(params.to, 'to') } : {}),
    };
    if (isReversedRange(range)) {
        throw new TaskApiError(n => `${n('from')} ${params.from} is after ${n('to')} ${params.to}`, 'from');
    }
    return [{ property: 'period', operator: 'overlaps', value: range }];
}

function normalizeStringArray(value: string | string[] | undefined, stripHash = false): string[] {
    if (!value) return [];
    const arr = typeof value === 'string' ? value.split(',') : value;
    return arr.map(s => { let v = s.trim(); if (stripHash) v = v.replace(/^#/, ''); return v; }).filter(Boolean);
}

function simpleConditions(params: SimpleFilterParams): FilterCondition[] {
    const conditions: FilterCondition[] = [];

    if (params.file) {
        const file = params.file.endsWith('.md') ? params.file : params.file + '.md';
        conditions.push({ property: 'file', operator: 'includes', value: [file] });
    }

    const statusArr = normalizeStringArray(params.status);
    if (statusArr.length > 0) {
        conditions.push({ property: 'status', operator: 'includes', value: statusArr });
    }

    const tagArr = normalizeStringArray(params.tag, true);
    if (tagArr.length > 0) {
        conditions.push({ property: 'tag', operator: 'includes', value: tagArr });
    }

    if (params.content) {
        conditions.push({ property: 'content', operator: 'contains', value: params.content });
    }

    if (params.due) {
        conditions.push({ property: 'due', operator: 'equals', value: readDateParam(params.due, 'due') });
    }

    if (params.leaf) {
        conditions.push({ property: 'children', operator: 'isNotSet' });
    }

    if (params.property) {
        const colonIdx = params.property.indexOf(':');
        if (colonIdx < 1) throw new TaskApiError('Invalid property filter format. Use "key:value"');
        const key = params.property.substring(0, colonIdx).trim();
        const value = params.property.substring(colonIdx + 1).trim();
        conditions.push({ property: 'property', operator: 'contains', key, value });
    }

    const colorArr = normalizeStringArray(params.color);
    if (colorArr.length > 0) {
        conditions.push({ property: 'color', operator: 'includes', value: colorArr });
    }

    const typeArr = normalizeStringArray(params.type);
    if (typeArr.length > 0) {
        conditions.push({ property: 'notation', operator: 'includes', value: typeArr });
    }

    if (params.root) {
        conditions.push({ property: 'parent', operator: 'isNotSet' });
    }

    return conditions;
}
