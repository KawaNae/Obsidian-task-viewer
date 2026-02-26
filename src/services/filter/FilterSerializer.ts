import type { FilterState, FilterConditionNode, FilterGroupNode, FilterNode } from './FilterTypes';
import { createEmptyFilterState } from './FilterTypes';

/**
 * Serialization utilities for FilterState (JSON persistence and URI encoding).
 * Handles v1 (array), v2 (flat {conditions, logic}), v3 (grouped {groups, logic}),
 * and v4 (recursive {root}) formats.
 */
export class FilterSerializer {
    static toJSON(state: FilterState): Record<string, unknown> {
        return JSON.parse(JSON.stringify({ version: 4, root: state.root }));
    }

    static fromJSON(raw: unknown): FilterState {
        if (!raw || typeof raw !== 'object') return createEmptyFilterState();
        const obj = raw as Record<string, unknown>;

        // v4: has root group
        if (obj.root && typeof obj.root === 'object') {
            return { root: parseGroupNode(obj.root as Record<string, unknown>) };
        }

        // v3: has groups array
        if (Array.isArray(obj.groups)) {
            return migrateV3(obj);
        }

        // v2: has conditions array (flat)
        if (Array.isArray(obj.conditions)) {
            return migrateV2(obj);
        }

        return createEmptyFilterState();
    }

    static toURIParam(state: FilterState): string {
        if (!hasAnyCondition(state.root)) return '';
        const json = JSON.stringify({ version: 4, root: state.root });
        return btoa(json);
    }

    static fromURIParam(param: string): FilterState {
        if (!param) return createEmptyFilterState();
        try {
            const json = atob(param);
            const parsed = JSON.parse(json);
            return this.fromJSON(parsed);
        } catch {
            return createEmptyFilterState();
        }
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
        return {
            root: { type: 'group', id: 'root', children: single.children, logic: single.logic },
        };
    }

    // Multi-group: each old group becomes a child of root
    return {
        root: { type: 'group', id: 'root', children: oldGroups, logic },
    };
}

function isValidOldGroup(g: unknown): g is Record<string, unknown> {
    return g != null && typeof g === 'object' && 'conditions' in (g as Record<string, unknown>);
}

function migrateOldGroup(g: Record<string, unknown>): FilterGroupNode {
    const conditions = Array.isArray(g.conditions)
        ? (g.conditions as unknown[]).filter(isValidConditionObj).map(migrateConditionToNode)
        : [];
    return {
        type: 'group',
        id: typeof g.id === 'string' ? g.id : 'g-unknown',
        children: conditions,
        logic: g.logic === 'or' ? 'or' : 'and',
    };
}

// ── v2 migration ──

function migrateV2(obj: Record<string, unknown>): FilterState {
    const conditions = (obj.conditions as unknown[])
        .filter(isValidConditionObj)
        .map(migrateConditionToNode);
    const logic = obj.logic === 'or' ? 'or' as const : 'and' as const;

    if (conditions.length === 0) return createEmptyFilterState();
    return {
        root: { type: 'group', id: 'root', children: conditions, logic },
    };
}

// ── v4 parsing (recursive) ──

function parseGroupNode(obj: Record<string, unknown>): FilterGroupNode {
    const children: FilterNode[] = [];
    if (Array.isArray(obj.children)) {
        for (const child of obj.children) {
            if (!child || typeof child !== 'object') continue;
            const c = child as Record<string, unknown>;
            if (c.type === 'group' && Array.isArray(c.children)) {
                children.push(parseGroupNode(c));
            } else if (c.type === 'condition' && isValidConditionObj(c)) {
                children.push(migrateConditionToNode(c));
            }
        }
    }
    return {
        type: 'group',
        id: typeof obj.id === 'string' ? obj.id : 'g-unknown',
        children,
        logic: obj.logic === 'or' ? 'or' : 'and',
    };
}

// ── Condition validation & migration ──

function isValidConditionObj(c: unknown): c is Record<string, unknown> {
    return c != null && typeof c === 'object' && 'property' in (c as Record<string, unknown>) && 'operator' in (c as Record<string, unknown>) && 'value' in (c as Record<string, unknown>);
}

function migrateConditionToNode(c: Record<string, unknown>): FilterConditionNode {
    let property = c.property as string;
    // Migrate removed properties: hasStartDate → startDate, hasDeadline → deadline
    if (property === 'hasStartDate') property = 'startDate';
    if (property === 'hasDeadline') property = 'deadline';

    return {
        type: 'condition',
        id: typeof c.id === 'string' ? c.id : 'f-unknown',
        property: property as FilterConditionNode['property'],
        operator: c.operator as FilterConditionNode['operator'],
        value: c.value as FilterConditionNode['value'],
    };
}

// ── Helpers ──

function hasAnyCondition(group: FilterGroupNode): boolean {
    return group.children.some(child =>
        child.type === 'condition' || hasAnyCondition(child),
    );
}
