import type { FilterState, FilterCondition, FilterGroup, FilterItem } from './FilterTypes';
import { createEmptyFilterState, isFilterCondition } from './FilterTypes';
import { unicodeBtoa, unicodeAtob } from '../../utils/base64';

/**
 * Serialization utilities for FilterState (JSON persistence and URI encoding).
 * Handles v2 (flat {conditions, logic}), v3 (grouped {groups, logic}),
 * v4 (recursive {root}), v5 ({conditions} flat), and v6 ({filters} flat) formats.
 */
export class FilterSerializer {
    static toJSON(state: FilterState): Record<string, unknown> {
        return serializeGroup(state);
    }

    static fromJSON(raw: unknown): FilterState {
        if (!raw || typeof raw !== 'object') return createEmptyFilterState();
        const obj = raw as Record<string, unknown>;

        // v4: has root group (old internal format with type/id)
        if (obj.root && typeof obj.root === 'object') {
            return parseV4GroupNode(obj.root as Record<string, unknown>);
        }

        // v3: has groups array
        if (Array.isArray(obj.groups)) {
            return migrateV3(obj);
        }

        // v6: has filters array (new format)
        if (Array.isArray(obj.filters)) {
            return parseV6Group(obj);
        }

        // v5 or v2: both have "conditions" array
        if (Array.isArray(obj.conditions)) {
            if (isV5ConditionsArray(obj.conditions)) {
                return parseV5Group(obj);
            }
            // v2: old flat conditions (has type/id inside conditions)
            return migrateV2(obj);
        }

        // v5/v6 single condition: has "property" directly
        if ('property' in obj && 'operator' in obj) {
            return { filters: [parseCondition(obj)], logic: 'and' };
        }

        // v5/v6 group with "logic" but no items key
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

// ── v5 detection ──

/**
 * Determine if a "conditions" array is v5 format vs v2 format.
 * v2 conditions always have { id, property, operator, value: { type: ... } }
 * v5 conditions have flat values and may include nested groups with "logic"/"conditions".
 */
function isV5ConditionsArray(conditions: unknown[]): boolean {
    if (conditions.length === 0) return true; // empty is ambiguous, treat as v5
    for (const item of conditions) {
        if (!item || typeof item !== 'object') continue;
        const c = item as Record<string, unknown>;
        // Nested group — only v5 has this
        if ('logic' in c || ('conditions' in c && Array.isArray(c.conditions))) return true;
        // v5 condition: has "property" but NOT old-style value with "type" discriminator
        if ('property' in c) {
            const v = c.value;
            if (v && typeof v === 'object' && !Array.isArray(v) && 'type' in (v as Record<string, unknown>)) {
                // Old FilterValue format { type: 'stringSet', ... } → v2/v4
                return false;
            }
            return true; // flat value → v5
        }
    }
    return false; // couldn't determine, default to v2
}

// ── v6 serialization (new format) ──

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

// ── v5 deserialization (conditions key) ──

function parseV5Group(obj: Record<string, unknown>): FilterGroup {
    const filters: FilterItem[] = [];
    if (Array.isArray(obj.conditions)) {
        for (const child of obj.conditions) {
            if (!child || typeof child !== 'object') continue;
            const c = child as Record<string, unknown>;
            if ('logic' in c || Array.isArray(c.conditions)) {
                filters.push(parseV5Group(c));
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

// ── v4 parsing (recursive, old internal format with type/id) ──

function parseV4GroupNode(obj: Record<string, unknown>): FilterGroup {
    const filters: FilterItem[] = [];
    if (Array.isArray(obj.children)) {
        for (const child of obj.children) {
            if (!child || typeof child !== 'object') continue;
            const c = child as Record<string, unknown>;
            if (c.type === 'group' && Array.isArray(c.children)) {
                filters.push(parseV4GroupNode(c));
            } else if (c.type === 'condition' && 'property' in c && 'operator' in c) {
                filters.push(migrateV4Condition(c));
            }
        }
    }
    return {
        filters,
        logic: obj.logic === 'or' ? 'or' : 'and',
    };
}

function migrateV4Condition(c: Record<string, unknown>): FilterCondition {
    const node: FilterCondition = {
        property: c.property as FilterCondition['property'],
        operator: c.operator as FilterCondition['operator'],
    };
    if (c.target === 'parent') node.target = 'parent';

    // Migrate old FilterValue format to flat values
    const v = c.value as Record<string, unknown> | undefined;
    if (v && typeof v === 'object' && 'type' in v) {
        migrateV4Value(node, v);
    } else {
        // Already flat or no value
        if (c.value !== undefined) node.value = c.value as FilterCondition['value'];
        if (c.key !== undefined) node.key = c.key as string;
        if (c.unit !== undefined) node.unit = c.unit as 'hours' | 'minutes';
    }

    return node;
}

function migrateV4Value(node: FilterCondition, v: Record<string, unknown>): void {
    switch (v.type) {
        case 'stringSet':
            node.value = (v.values as string[]) ?? [];
            break;
        case 'string':
            node.value = (v.value as string) ?? '';
            break;
        case 'date': {
            const dateVal = v.value as Record<string, unknown> | undefined;
            if (dateVal && typeof dateVal === 'object') {
                if (dateVal.mode === 'absolute') {
                    node.value = (dateVal.date as string) ?? '';
                } else {
                    // relative
                    const result: { preset: string; n?: number } = { preset: (dateVal.preset as string) ?? 'today' };
                    if (dateVal.n !== undefined) result.n = dateVal.n as number;
                    node.value = result as FilterCondition['value'];
                }
            }
            break;
        }
        case 'number':
            node.value = (v.value as number) ?? 0;
            if (v.unit) node.unit = v.unit as 'hours' | 'minutes';
            break;
        case 'property':
            node.value = (v.value as string) ?? '';
            node.key = (v.key as string) ?? '';
            break;
        case 'boolean':
            // boolean type used for isSet/isNotSet — no value needed
            break;
    }
}

// ── v3 migration ──

function migrateV3(obj: Record<string, unknown>): FilterState {
    const oldGroups = (obj.groups as unknown[])
        .filter(isValidOldGroup)
        .map(migrateOldGroup);
    const logic = obj.logic === 'or' ? 'or' as const : 'and' as const;

    // Single-group optimization: flatten into root
    if (oldGroups.length === 1) {
        const single = oldGroups[0];
        return { filters: single.filters, logic: single.logic };
    }

    // Multi-group: each old group becomes a child of root
    return { filters: oldGroups, logic };
}

function isValidOldGroup(g: unknown): g is Record<string, unknown> {
    return g != null && typeof g === 'object' && 'conditions' in (g as Record<string, unknown>);
}

function migrateOldGroup(g: Record<string, unknown>): FilterGroup {
    const conditions = Array.isArray(g.conditions)
        ? (g.conditions as unknown[]).filter(isValidV2ConditionObj).map(migrateV2ConditionToNode)
        : [];
    return {
        filters: conditions,
        logic: g.logic === 'or' ? 'or' : 'and',
    };
}

// ── v2 migration ──

function migrateV2(obj: Record<string, unknown>): FilterState {
    const conditions = (obj.conditions as unknown[])
        .filter(isValidV2ConditionObj)
        .map(migrateV2ConditionToNode);
    const logic = obj.logic === 'or' ? 'or' as const : 'and' as const;

    if (conditions.length === 0) return createEmptyFilterState();
    return { filters: conditions, logic };
}

// ── v2/v3 Condition validation & migration ──

function isValidV2ConditionObj(c: unknown): c is Record<string, unknown> {
    return c != null && typeof c === 'object' && 'property' in (c as Record<string, unknown>) && 'operator' in (c as Record<string, unknown>) && 'value' in (c as Record<string, unknown>);
}

function migrateV2ConditionToNode(c: Record<string, unknown>): FilterCondition {
    // v2/v3 conditions use old FilterValue format
    return migrateV4Condition(c);
}

// ── Helpers ──

function hasAnyCondition(group: FilterGroup): boolean {
    return group.filters.some(child =>
        isFilterCondition(child) || hasAnyCondition(child),
    );
}
