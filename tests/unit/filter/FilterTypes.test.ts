import { describe, it, expect } from 'vitest';
import {
    createEmptyFilterState,
    createFilterGroup,
    createDefaultCondition,
    hasConditions,
    isFilterCondition,
} from '../../../src/services/filter/FilterTypes';
import type { FilterGroup, FilterState } from '../../../src/services/filter/FilterTypes';

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

    describe('type guards', () => {
        it('isFilterCondition identifies conditions', () => {
            const c = createDefaultCondition();
            expect(isFilterCondition(c)).toBe(true);
        });

        it('isFilterCondition rejects groups', () => {
            const g = createFilterGroup();
            expect(isFilterCondition(g)).toBe(false);
        });
    });
});
