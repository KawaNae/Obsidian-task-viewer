import type { FilterState, FilterCondition, FilterGroup } from './FilterTypes';
import { createEmptyFilterState } from './FilterTypes';

/**
 * Serialization utilities for FilterState (JSON persistence and URI encoding).
 * Handles v1 (array), v2 (flat {conditions, logic}), and v3 (grouped {groups, logic}) formats.
 */
export class FilterSerializer {
    static toJSON(state: FilterState): Record<string, unknown> {
        return JSON.parse(JSON.stringify({ version: 3, groups: state.groups, logic: state.logic }));
    }

    static fromJSON(raw: unknown): FilterState {
        if (!raw || typeof raw !== 'object') return createEmptyFilterState();
        const obj = raw as Record<string, unknown>;

        // v3: has groups array
        if (Array.isArray(obj.groups)) {
            const groups = (obj.groups as unknown[])
                .filter(isValidGroup)
                .map(normalizeGroup);
            const logic = obj.logic === 'or' ? 'or' as const : 'and' as const;
            return { groups, logic };
        }

        // v2: has conditions array (flat)
        if (Array.isArray(obj.conditions)) {
            const conditions = parseConditions(obj.conditions);
            const logic = obj.logic === 'or' ? 'or' as const : 'and' as const;
            return conditions.length > 0
                ? { groups: [{ id: 'migrated', conditions, logic }], logic: 'and' }
                : createEmptyFilterState();
        }

        return createEmptyFilterState();
    }

    /**
     * Encode filter state for URI query parameter (base64-encoded JSON).
     */
    static toURIParam(state: FilterState): string {
        if (state.groups.length === 0) return '';
        if (state.groups.every(g => g.conditions.length === 0)) return '';
        const json = JSON.stringify({ version: 3, groups: state.groups, logic: state.logic });
        return btoa(json);
    }

    /**
     * Decode filter state from URI query parameter.
     * Handles v1 (array), v2 ({conditions, logic}), and v3 ({groups, logic}).
     */
    static fromURIParam(param: string): FilterState {
        if (!param) return createEmptyFilterState();
        try {
            const json = atob(param);
            const parsed = JSON.parse(json);
            if (!parsed || typeof parsed !== 'object') return createEmptyFilterState();

            // v3: has groups
            if (Array.isArray(parsed.groups)) {
                return this.fromJSON(parsed);
            }

            // v2: {conditions, logic}
            if (!Array.isArray(parsed) && Array.isArray(parsed.conditions)) {
                return this.fromJSON(parsed);
            }

            // v1: conditions array directly
            if (Array.isArray(parsed)) {
                const conditions = parseConditions(parsed);
                return conditions.length > 0
                    ? { groups: [{ id: 'migrated', conditions, logic: 'and' }], logic: 'and' }
                    : createEmptyFilterState();
            }

            return createEmptyFilterState();
        } catch {
            return createEmptyFilterState();
        }
    }
}

function isValidCondition(c: unknown): c is FilterCondition {
    return c != null && typeof c === 'object' && 'property' in c && 'operator' in c && 'value' in c;
}

function parseConditions(arr: unknown[]): FilterCondition[] {
    return arr.filter(isValidCondition).map(migrateCondition);
}

/** Migrate removed properties: hasStartDate → startDate, hasDeadline → deadline */
function migrateCondition(c: FilterCondition): FilterCondition {
    if (c.property === 'hasStartDate' as string) {
        return { ...c, property: 'startDate' };
    }
    if (c.property === 'hasDeadline' as string) {
        return { ...c, property: 'deadline' };
    }
    return c;
}

function isValidGroup(g: unknown): g is Record<string, unknown> {
    return g != null && typeof g === 'object' && 'conditions' in (g as Record<string, unknown>);
}

function normalizeGroup(g: Record<string, unknown>): FilterGroup {
    const conditions = Array.isArray(g.conditions) ? parseConditions(g.conditions) : [];
    const logic = g.logic === 'or' ? 'or' as const : 'and' as const;
    const id = typeof g.id === 'string' ? g.id : 'g-unknown';
    return { id, conditions, logic };
}
