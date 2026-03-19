import { describe, it, expect } from 'vitest';
import {
    createEmptyFilterState,
    createFilterGroup,
    createDefaultCondition,
    hasConditions,
    getAllConditions,
    deepCloneNode,
} from '../../src/services/filter/FilterTypes';
import type { FilterConditionNode, FilterGroupNode, FilterState } from '../../src/services/filter/FilterTypes';

describe('FilterTypes utilities', () => {
    describe('createEmptyFilterState', () => {
        it('returns state with empty root group', () => {
            const state = createEmptyFilterState();
            expect(state.root.type).toBe('group');
            expect(state.root.children).toHaveLength(0);
            expect(state.root.logic).toBe('and');
        });
    });

    describe('createDefaultCondition', () => {
        it('creates tag/includes condition with empty values', () => {
            const c = createDefaultCondition();
            expect(c.type).toBe('condition');
            expect(c.property).toBe('tag');
            expect(c.operator).toBe('includes');
            expect(c.value).toEqual([]);
        });
    });

    describe('hasConditions', () => {
        it('returns false for empty state', () => {
            expect(hasConditions(createEmptyFilterState())).toBe(false);
        });

        it('returns true when condition exists', () => {
            const state: FilterState = {
                root: {
                    type: 'group', logic: 'and',
                    children: [createDefaultCondition()],
                },
            };
            expect(hasConditions(state)).toBe(true);
        });

        it('returns true for nested condition', () => {
            const inner: FilterGroupNode = {
                type: 'group', logic: 'and',
                children: [createDefaultCondition()],
            };
            const state: FilterState = {
                root: { type: 'group', logic: 'and', children: [inner] },
            };
            expect(hasConditions(state)).toBe(true);
        });

        it('returns false for nested empty groups', () => {
            const inner: FilterGroupNode = {
                type: 'group', logic: 'and', children: [],
            };
            const state: FilterState = {
                root: { type: 'group', logic: 'and', children: [inner] },
            };
            expect(hasConditions(state)).toBe(false);
        });
    });

    describe('getAllConditions', () => {
        it('returns empty array for empty state', () => {
            expect(getAllConditions(createEmptyFilterState())).toEqual([]);
        });

        it('flattens conditions from nested groups', () => {
            const c1 = createDefaultCondition();
            const c2 = createDefaultCondition();
            const inner: FilterGroupNode = {
                type: 'group', logic: 'and', children: [c2],
            };
            const state: FilterState = {
                root: { type: 'group', logic: 'and', children: [c1, inner] },
            };
            const all = getAllConditions(state);
            expect(all).toHaveLength(2);
        });
    });

    describe('deepCloneNode', () => {
        it('clones condition preserving all fields', () => {
            const original = createDefaultCondition();
            const cloned = deepCloneNode(original) as FilterConditionNode;
            expect(cloned.property).toBe(original.property);
            expect(cloned.operator).toBe(original.operator);
            expect(cloned.value).toEqual(original.value);
            // Verify it's a deep copy
            expect(cloned).not.toBe(original);
        });

        it('clones group recursively', () => {
            const c = createDefaultCondition();
            const group: FilterGroupNode = {
                type: 'group', logic: 'or', children: [c],
            };
            const cloned = deepCloneNode(group) as FilterGroupNode;
            expect(cloned.logic).toBe('or');
            expect(cloned.children).toHaveLength(1);
            expect(cloned.children[0]).not.toBe(c);
        });
    });
});
