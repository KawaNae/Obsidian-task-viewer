import type { FilterState, FilterCondition, FilterGroup } from '../services/filter/FilterTypes';
import { FilterSerializer } from '../services/filter/FilterSerializer';
import { parseDatePreset } from '../cli/CliDatePresetParser';
import { TaskApiError } from './TaskApiTypes';
import type { ListParams } from './TaskApiTypes';

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
        if ('filters' in params.filter) return params.filter;
        return FilterSerializer.fromJSON(params.filter);
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

    if (params.date) {
        if (params.from || params.to) {
            throw new TaskApiError("Cannot use 'date' together with 'from'/'to'. Use either 'date' for a specific date, or 'from'/'to' for a range.");
        }
        const dateValue = parseDatePreset(params.date);
        if (!dateValue) throw new TaskApiError(`Invalid date value: ${params.date}. Use YYYY-MM-DD or a preset (today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear, next7days)`);
        conditions.push(condition('startDate', 'onOrBefore', dateValue));
        conditions.push(condition('endDate', 'onOrAfter', dateValue));
    } else {
        if (params.from) {
            const fromValue = parseDatePreset(params.from);
            if (!fromValue) throw new TaskApiError(`Invalid date value for from: ${params.from}. Use YYYY-MM-DD or a preset`);
            conditions.push(condition('startDate', 'onOrAfter', fromValue));
        }
        if (params.to) {
            const toValue = parseDatePreset(params.to);
            if (!toValue) throw new TaskApiError(`Invalid date value for to: ${params.to}. Use YYYY-MM-DD or a preset`);
            conditions.push(condition('endDate', 'onOrBefore', toValue));
        }
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
