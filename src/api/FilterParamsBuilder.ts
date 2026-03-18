import type { FilterState, FilterConditionNode, FilterGroupNode } from '../services/filter/FilterTypes';
import { parseDatePreset } from '../cli/CliDatePresetParser';
import { TaskApiError } from './TaskApiTypes';
import type { ListParams } from './TaskApiTypes';

// ── Internal helpers ──

function generateId(prefix: string): string {
    return `${prefix}-api-${Math.random().toString(36).slice(2, 7)}`;
}

function condition(
    property: FilterConditionNode['property'],
    operator: FilterConditionNode['operator'],
    value: FilterConditionNode['value'],
): FilterConditionNode {
    return { type: 'condition', id: generateId('f'), property, operator, value };
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
    if (params.filter) return params.filter;

    const conditions: FilterConditionNode[] = [];

    if (params.file) {
        const file = params.file.endsWith('.md') ? params.file : params.file + '.md';
        conditions.push(condition('file', 'includes', {
            type: 'stringSet', values: [file],
        }));
    }

    const statusArr = normalizeStringArray(params.status);
    if (statusArr.length > 0) {
        conditions.push(condition('status', 'includes', {
            type: 'stringSet', values: statusArr,
        }));
    }

    const tagArr = normalizeStringArray(params.tag, true);
    if (tagArr.length > 0) {
        conditions.push(condition('tag', 'includes', {
            type: 'stringSet', values: tagArr,
        }));
    }

    if (params.content) {
        conditions.push(condition('content', 'contains', {
            type: 'string', value: params.content,
        }));
    }

    if (params.date) {
        if (params.from || params.to) {
            throw new TaskApiError("Cannot use 'date' together with 'from'/'to'. Use either 'date' for a specific date, or 'from'/'to' for a range.");
        }
        const dateValue = parseDatePreset(params.date);
        if (!dateValue) throw new TaskApiError(`Invalid date value: ${params.date}. Use YYYY-MM-DD or a preset (today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear, next7days)`);
        conditions.push(condition('startDate', 'onOrBefore', { type: 'date', value: dateValue }));
        conditions.push(condition('endDate', 'onOrAfter', { type: 'date', value: dateValue }));
    } else {
        if (params.from) {
            const fromValue = parseDatePreset(params.from);
            if (!fromValue) throw new TaskApiError(`Invalid date value for from: ${params.from}. Use YYYY-MM-DD or a preset`);
            conditions.push(condition('startDate', 'onOrAfter', { type: 'date', value: fromValue }));
        }
        if (params.to) {
            const toValue = parseDatePreset(params.to);
            if (!toValue) throw new TaskApiError(`Invalid date value for to: ${params.to}. Use YYYY-MM-DD or a preset`);
            conditions.push(condition('endDate', 'onOrBefore', { type: 'date', value: toValue }));
        }
    }

    if (params.due) {
        const dueValue = parseDatePreset(params.due);
        if (!dueValue) throw new TaskApiError(`Invalid date value for due: ${params.due}. Use YYYY-MM-DD or a preset`);
        conditions.push(condition('due', 'equals', { type: 'date', value: dueValue }));
    }

    if (params.leaf) {
        conditions.push(condition('children', 'isNotSet', { type: 'boolean', value: true }));
    }

    if (params.property) {
        const colonIdx = params.property.indexOf(':');
        if (colonIdx < 1) throw new TaskApiError('Invalid property filter format. Use "key:value"');
        const key = params.property.substring(0, colonIdx).trim();
        const value = params.property.substring(colonIdx + 1).trim();
        conditions.push(condition('property', 'contains', { type: 'property', key, value }));
    }

    const colorArr = normalizeStringArray(params.color);
    if (colorArr.length > 0) {
        conditions.push(condition('color', 'includes', {
            type: 'stringSet', values: colorArr,
        }));
    }

    const typeArr = normalizeStringArray(params.type);
    if (typeArr.length > 0) {
        conditions.push(condition('taskType', 'includes', {
            type: 'stringSet', values: typeArr,
        }));
    }

    if (params.root) {
        conditions.push(condition('parent', 'isNotSet', { type: 'boolean', value: true }));
    }

    if (conditions.length === 0) return null;

    const root: FilterGroupNode = {
        type: 'group',
        id: generateId('g'),
        children: conditions,
        logic: 'and',
    };
    return { root };
}
