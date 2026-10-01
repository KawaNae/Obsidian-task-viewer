import type { FilterState, FilterCondition } from '../services/filter/FilterTypes';
import { FilterSerializer, filterIssueText } from '../services/filter/FilterSerializer';
import { DATE_PRESET_SYNTAX, parseDatePreset } from '../services/filter/DatePreset';
import type { DateFilterValue } from '../services/filter/FilterTypes';
import type { App } from 'obsidian';
import { TaskApiError } from './TaskApiTypes';
import type { ListParams, SimpleFilterParams, FilterSourceParams } from './TaskApiTypes';
import { loadFilterFile } from './FilterFileLoader';

/**
 * A date parameter that takes a preset (`due`, `date`, `from`, `to`):
 * a day that exists, or a preset. The one place its error is worded.
 */
export function readDateParam(value: string, name: string): DateFilterValue {
    const read = parseDatePreset(value);
    if (read.ok) return read.value;
    if (read.issue.code === 'noSuchDay') throw TaskApiError.ofIssue(read.issue, name, value);
    throw new TaskApiError(n => `Invalid date value for ${n(name)}: ${value}. Use YYYY-MM-DD or a preset (${DATE_PRESET_SYNTAX})`, name);
}

// ── Internal helpers ──

function normalizeStringArray(value: string | string[] | undefined, stripHash = false): string[] {
    if (!value) return [];
    const arr = typeof value === 'string' ? value.split(',') : value;
    return arr.map(s => { let v = s.trim(); if (stripHash) v = v.replace(/^#/, ''); return v; }).filter(Boolean);
}

function buildSimpleFieldConditions(params: SimpleFilterParams): FilterCondition[] {
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

/**
 * The `filter` param, read by the one reader of saved filters. A part it
 * cannot read is an error: the API does not run a query on less than it was
 * asked.
 */
function readExplicitFilter(filter: FilterState | Record<string, unknown>): FilterState {
    const { state, issues } = FilterSerializer.parse(filter);
    if (issues.length > 0) {
        throw new TaskApiError(`Invalid filter: ${issues.map(filterIssueText).join('; ')}`);
    }
    return state;
}

/** `list`'s own query window: the conditions `date`, or `from` and `to`, make. */
export type QueryWindowParams = Pick<ListParams, 'date' | 'from' | 'to'>;

function windowConditions(params: QueryWindowParams): FilterCondition[] {
    // Query window (inclusive overlap): a task matches when its effective
    // span intersects [from, to]. `date` is sugar for a single-day window
    // (from=X to=X), presets included, so the whole family shares one rule:
    //   from → the task must not end before the window starts
    //   to   → the task must not start after the window ends
    if (params.date && (params.from || params.to)) {
        throw new TaskApiError(n => `Cannot use '${n('date')}' together with '${n('from')}'/'${n('to')}'. Use either '${n('date')}' for a single-day window, or '${n('from')}'/'${n('to')}' for a range.`, 'date');
    }
    const conditions: FilterCondition[] = [];
    const windowFrom = params.date ?? params.from;
    const windowTo = params.date ?? params.to;
    const windowFromName = params.date ? 'date' : 'from';
    const windowToName = params.date ? 'date' : 'to';
    if (windowFrom) {
        conditions.push({ property: 'endDate', operator: 'onOrAfter', value: readDateParam(windowFrom, windowFromName) });
    }
    if (windowTo) {
        conditions.push({ property: 'startDate', operator: 'onOrBefore', value: readDateParam(windowTo, windowToName) });
    }
    return conditions;
}

/**
 * The FilterState the params name, or null when they name no condition. An
 * explicit `filter` wins over everything else; otherwise the simple fields
 * make it, together with `window`'s conditions when given (`list`'s own
 * query window — the range operations pass none: their window is applied
 * apart, and two date judgments must never stack). What is overridden is
 * not read, so it is not checked either.
 */
export function filterOfParams(
    params: SimpleFilterParams & { filter?: FilterState | Record<string, unknown> },
    window?: QueryWindowParams,
): FilterState | null {
    if (params.filter) return readExplicitFilter(params.filter);
    const conditions = [...buildSimpleFieldConditions(params), ...(window ? windowConditions(window) : [])];
    return conditions.length === 0 ? null : { filters: conditions, logic: 'and' };
}

/**
 * The filter a query uses, wherever its params say it comes from: the filter
 * file's (`list` picks one pinned list out of a .md template), else `filter`,
 * else the simple fields and `window` ({@link filterOfParams}). `list` and the
 * date-range family both resolve their filter here.
 */
export async function resolveFilterSource(
    app: App,
    params: SimpleFilterParams & FilterSourceParams,
    window?: QueryWindowParams,
): Promise<FilterState | null> {
    if (params.list && !params.filterFile) {
        throw new TaskApiError(n => `'${n('list')}' requires '${n('filterFile')}' (a .md view template)`, 'list');
    }
    if (!params.filterFile) return filterOfParams(params, window);
    const loaded = await loadFilterFile(app, params.filterFile, params.list);
    if (typeof loaded === 'string') throw new TaskApiError(loaded);
    // The list's own sort is not read: the query's order is `sort`'s alone,
    // until the pinned-list order is decided for the API (point Q).
    return loaded.filter;
}
