import { describe, it, expect } from 'vitest';
import {
    createEmptyFilterState,
    createFilterGroup,
    createDefaultCondition,
    hasConditions,
    getAllConditions,
    deepCloneNode,
    isFilterCondition,
    isFilterGroup,
} from '../../src/services/filter/FilterTypes';
import type { FilterCondition, FilterGroup, FilterState } from '../../src/services/filter/FilterTypes';

describe('FilterTypes utilities', () => {
    describe('createEmptyFilterState', () => {
        it('returns state with empty filters', () => {
            const state = createEmptyFilterState();
            expect(state.filters).toHaveLength(0);
            expect(state.logic).toBe('and');
        });
    });

    describe('createDefaultCondition', () => {
        it('creates tag/includes condition with empty values', () => {
            const c = createDefaultCondition();
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
                filters: [createDefaultCondition()],
                logic: 'and',
            };
            expect(hasConditions(state)).toBe(true);
        });

        it('returns true for nested condition', () => {
            const inner: FilterGroup = {
                filters: [createDefaultCondition()],
                logic: 'and',
            };
            const state: FilterState = { filters: [inner], logic: 'and' };
            expect(hasConditions(state)).toBe(true);
        });

        it('returns false for nested empty groups', () => {
            const inner: FilterGroup = { filters: [], logic: 'and' };
            const state: FilterState = { filters: [inner], logic: 'and' };
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
            const inner: FilterGroup = { filters: [c2], logic: 'and' };
            const state: FilterState = { filters: [c1, inner], logic: 'and' };
            const all = getAllConditions(state);
            expect(all).toHaveLength(2);
        });
    });

    describe('deepCloneNode', () => {
        it('clones condition preserving all fields', () => {
            const original = createDefaultCondition();
            const cloned = deepCloneNode(original) as FilterCondition;
            expect(cloned.property).toBe(original.property);
            expect(cloned.operator).toBe(original.operator);
            expect(cloned.value).toEqual(original.value);
            // Verify it's a deep copy
            expect(cloned).not.toBe(original);
        });

        it('clones group recursively', () => {
            const c = createDefaultCondition();
            const group: FilterGroup = { filters: [c], logic: 'or' };
            const cloned = deepCloneNode(group) as FilterGroup;
            expect(cloned.logic).toBe('or');
            expect(cloned.filters).toHaveLength(1);
            expect(cloned.filters[0]).not.toBe(c);
        });
    });

    describe('type guards', () => {
        it('isFilterCondition identifies conditions', () => {
            const c = createDefaultCondition();
            expect(isFilterCondition(c)).toBe(true);
            expect(isFilterGroup(c)).toBe(false);
        });

        it('isFilterGroup identifies groups', () => {
            const g = createFilterGroup();
            expect(isFilterGroup(g)).toBe(true);
            expect(isFilterCondition(g)).toBe(false);
        });
    });
});
