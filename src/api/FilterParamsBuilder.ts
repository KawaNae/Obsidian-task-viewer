import type { FilterState, FilterCondition, FilterGroup, FilterProperty } from '../services/filter/FilterTypes';
import { getAllConditions, PROPERTY_OPERATORS } from '../services/filter/FilterTypes';
import { FilterSerializer } from '../services/filter/FilterSerializer';
import { parseDatePreset } from '../cli/CliDatePresetParser';
import { TaskApiError } from './TaskApiTypes';
import type { ListParams } from './TaskApiTypes';

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

export function normalizeStringArray(value: string | string[] | undefined, stripHash = false): string[] {
    if (!value) return [];
    const arr = typeof value === 'string' ? value.split(',') : value;
    return arr.map(s => { let v = s.trim(); if (stripHash) v = v.replace(/^#/, ''); return v; }).filter(Boolean);
}

/**
 * Build a FilterState from simple ListParams fields.
 * Returns null if no filter conditions are needed.
 * If params.filter is provided, it overrides all simple fields.
 */
export function buildFilterFromParams(params: ListParams): FilterState | null {
    if (params.filter) {
        const state = 'filters' in params.filter
            ? params.filter
            : FilterSerializer.fromJSON(params.filter);
        assertValidFilterState(state);
        return state;
    }

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

    // Query window (inclusive overlap): a task matches when its effective
    // span intersects [from, to]. `date` is sugar for a single-day window
    // (from=X to=X), presets included, so the whole family shares one rule:
    //   from → the task must not end before the window starts
    //   to   → the task must not start after the window ends
    if (params.date && (params.from || params.to)) {
        throw new TaskApiError("Cannot use 'date' together with 'from'/'to'. Use either 'date' for a single-day window, or 'from'/'to' for a range.");
    }
    const windowFrom = params.date ?? params.from;
    const windowTo = params.date ?? params.to;
    const windowFromName = params.date ? 'date' : 'from';
    const windowToName = params.date ? 'date' : 'to';
    if (windowFrom) {
        const fromValue = parseDatePreset(windowFrom);
        if (!fromValue) throw new TaskApiError(`Invalid date value for ${windowFromName}: ${windowFrom}. Use YYYY-MM-DD or a preset (today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear, nextNdays)`);
        conditions.push(condition('endDate', 'onOrAfter', fromValue));
    }
    if (windowTo) {
        const toValue = parseDatePreset(windowTo);
        if (!toValue) throw new TaskApiError(`Invalid date value for ${windowToName}: ${windowTo}. Use YYYY-MM-DD or a preset (today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear, nextNdays)`);
        conditions.push(condition('startDate', 'onOrBefore', toValue));
    }

    if (params.due) {
        const dueValue = parseDatePreset(params.due);
        if (!dueValue) throw new TaskApiError(`Invalid date value for due: ${params.due}. Use YYYY-MM-DD or a preset`);
        conditions.push(condition('due', 'equals', dueValue));
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

    if (conditions.length === 0) return null;

    return { filters: conditions, logic: 'and' };
}
