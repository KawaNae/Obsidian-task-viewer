import type { FilterState, FilterCondition, FilterGroup, FilterItem } from './FilterTypes';
import { createEmptyFilterState, isFilterCondition } from './FilterTypes';
import { unicodeBtoa, unicodeAtob } from '../../utils/base64';

/**
 * Serialization utilities for FilterState (JSON persistence and URI encoding).
 */
export class FilterSerializer {
    static toJSON(state: FilterState): Record<string, unknown> {
        return serializeGroup(state);
    }

    static fromJSON(raw: unknown): FilterState {
        if (!raw || typeof raw !== 'object') return createEmptyFilterState();
        const obj = raw as Record<string, unknown>;

        // v6: has filters array
        if (Array.isArray(obj.filters)) {
            return parseV6Group(obj);
        }

        // Single condition: has "property" directly
        if ('property' in obj && 'operator' in obj) {
            return { filters: [parseCondition(obj)], logic: 'and' };
        }

        // Group with "logic" but no filters key
        if ('logic' in obj) {
            return { filters: [], logic: obj.logic === 'or' ? 'or' : 'and' };
        }

        return createEmptyFilterState();
    }

    static toURIParam(state: FilterState): string {
        if (!hasAnyCondition(state)) return '';
        const json = JSON.stringify(this.toJSON(state));
        return unicodeBtoa(json);
    }

    static fromURIParam(param: string): FilterState {
        if (!param) return createEmptyFilterState();
        try {
            const json = unicodeAtob(param);
            const parsed = JSON.parse(json);
            return this.fromJSON(parsed);
        } catch {
            return createEmptyFilterState();
        }
    }
}

// ── Serialization ──

function serializeGroup(group: FilterGroup): Record<string, unknown> {
    return {
        logic: group.logic,
        filters: group.filters.map(serializeItem),
    };
}

function serializeItem(node: FilterItem): Record<string, unknown> {
    if (isFilterCondition(node)) {
        return serializeCondition(node);
    }
    return serializeGroup(node);
}

function serializeCondition(c: FilterCondition): Record<string, unknown> {
    const result: Record<string, unknown> = {
        property: c.property,
        operator: c.operator,
    };
    if (c.value !== undefined) result.value = c.value;
    if (c.key !== undefined) result.key = c.key;
    if (c.unit !== undefined) result.unit = c.unit;
    if (c.target !== undefined) result.target = c.target;
    return result;
}

// ── v6 deserialization (new format) ──

function parseV6Group(obj: Record<string, unknown>): FilterGroup {
    const filters: FilterItem[] = [];
    if (Array.isArray(obj.filters)) {
        for (const child of obj.filters) {
            if (!child || typeof child !== 'object') continue;
            const c = child as Record<string, unknown>;
            if ('filters' in c || 'logic' in c) {
                filters.push(parseV6Group(c));
            } else if ('property' in c) {
                filters.push(parseCondition(c));
            }
        }
    }
    return {
        filters,
        logic: obj.logic === 'or' ? 'or' : 'and',
    };
}

function parseCondition(c: Record<string, unknown>): FilterCondition {
    const node: FilterCondition = {
        property: c.property as FilterCondition['property'],
        operator: c.operator as FilterCondition['operator'],
    };
    if (c.value !== undefined) node.value = c.value as FilterCondition['value'];
    if (c.key !== undefined) node.key = c.key as string;
    if (c.unit !== undefined) node.unit = c.unit as 'hours' | 'minutes';
    if (c.target === 'parent') node.target = 'parent';
    return node;
}

// ── Helpers ──

function hasAnyCondition(group: FilterGroup): boolean {
    return group.filters.some(child =>
        isFilterCondition(child) || hasAnyCondition(child),
    );
}
