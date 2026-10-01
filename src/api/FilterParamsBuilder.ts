import type { FilterState, FilterCondition, FilterGroup, FilterProperty } from '../services/filter/FilterTypes';
import { getAllConditions, PROPERTY_OPERATORS } from '../services/filter/FilterTypes';
import { FilterSerializer } from '../services/filter/FilterSerializer';
import { DATE_PRESET_SYNTAX, parseDatePreset } from '../services/filter/DatePreset';
import type { DateFilterValue } from '../services/filter/FilterTypes';
import { issueText } from '../utils/values/IssueText';
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
    if (read.issue.code === 'noSuchDay') throw new TaskApiError(issueText(read.issue, name, value));
    throw new TaskApiError(`Invalid date value for ${name}: ${value}. Use YYYY-MM-DD or a preset (${DATE_PRESET_SYNTAX})`);
}

/**
 * Boundary validation for externally supplied FilterState (API `filter`
 * param, CLI `filter-file`). The filter engine silently passes unknown
 * properties/operators through as all-match, so typos in a filter JSON
 * would otherwise go undetected. Internal (UI-built) filters don't pass
 * through here.
 */
export function assertValidFilterState(state: FilterState): void {
    for (const cond of getAllConditions(state)) {
        const ops = PROPERTY_OPERATORS[cond.property as FilterProperty];
        if (!ops) {
            throw new TaskApiError(
                `Unknown filter property: ${String(cond.property)}. Available: ${Object.keys(PROPERTY_OPERATORS).join(', ')}`,
            );
        }
        if (!ops.includes(cond.operator)) {
            throw new TaskApiError(
                `Invalid operator '${String(cond.operator)}' for filter property '${String(cond.property)}'. Available: ${ops.join(', ')}`,
            );
        }
    }
}

// ── Internal helpers ──

function condition(
    property: FilterCondition['property'],
    operator: FilterCondition['operator'],
    value?: FilterCondition['value'],
    extra?: { key?: string; unit?: 'hours' | 'minutes' },
): FilterCondition {
    const node: FilterCondition = { property, operator };
    if (value !== undefined) node.value = value;
    if (extra?.key) node.key = extra.key;
    if (extra?.unit) node.unit = extra.unit;
    return node;
}

function normalizeStringArray(value: string | string[] | undefined, stripHash = false): string[] {
    if (!value) return [];
    const arr = typeof value === 'string' ? value.split(',') : value;
    return arr.map(s => { let v = s.trim(); if (stripHash) v = v.replace(/^#/, ''); return v; }).filter(Boolean);
}

function buildSimpleFieldConditions(params: SimpleFilterParams): FilterCondition[] {
    const conditions: FilterCondition[] = [];

    if (params.file) {
        const file = params.file.endsWith('.md') ? params.file : params.file + '.md';
        conditions.push(condition('file', 'includes', [file]));
    }

    const statusArr = normalizeStringArray(params.status);
    if (statusArr.length > 0) {
        conditions.push(condition('status', 'includes', statusArr));
    }

    const tagArr = normalizeStringArray(params.tag, true);
    if (tagArr.length > 0) {
        conditions.push(condition('tag', 'includes', tagArr));
    }

    if (params.content) {
        conditions.push(condition('content', 'contains', params.content));
    }

    if (params.due) {
        conditions.push(condition('due', 'equals', readDateParam(params.due, 'due')));
    }

    if (params.leaf) {
        conditions.push(condition('children', 'isNotSet'));
    }

    if (params.property) {
        const colonIdx = params.property.indexOf(':');
        if (colonIdx < 1) throw new TaskApiError('Invalid property filter format. Use "key:value"');
        const key = params.property.substring(0, colonIdx).trim();
        const value = params.property.substring(colonIdx + 1).trim();
        conditions.push(condition('property', 'contains', value, { key }));
    }

    const colorArr = normalizeStringArray(params.color);
    if (colorArr.length > 0) {
        conditions.push(condition('color', 'includes', colorArr));
    }

    const typeArr = normalizeStringArray(params.type);
    if (typeArr.length > 0) {
        conditions.push(condition('notation', 'includes', typeArr));
    }

    if (params.root) {
        conditions.push(condition('parent', 'isNotSet'));
    }

    return conditions;
}

/** A FilterState handed in from outside (`filter`, or a filter file's), parsed and validated. */
function readExplicitFilter(filter: FilterState | Record<string, unknown>): FilterState {
    const state = 'filters' in filter ? filter as FilterState : FilterSerializer.fromJSON(filter);
    assertValidFilterState(state);
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
        throw new TaskApiError("Cannot use 'date' together with 'from'/'to'. Use either 'date' for a single-day window, or 'from'/'to' for a range.");
    }
    const conditions: FilterCondition[] = [];
    const windowFrom = params.date ?? params.from;
    const windowTo = params.date ?? params.to;
    const windowFromName = params.date ? 'date' : 'from';
    const windowToName = params.date ? 'date' : 'to';
    if (windowFrom) {
        conditions.push(condition('endDate', 'onOrAfter', readDateParam(windowFrom, windowFromName)));
    }
    if (windowTo) {
        conditions.push(condition('startDate', 'onOrBefore', readDateParam(windowTo, windowToName)));
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
        throw new TaskApiError("'list' requires 'filterFile' (a .md view template)");
    }
    if (!params.filterFile) return filterOfParams(params, window);
    const loaded = await loadFilterFile(app, params.filterFile, params.list);
    if (typeof loaded === 'string') throw new TaskApiError(loaded);
    return readExplicitFilter(loaded);
}
