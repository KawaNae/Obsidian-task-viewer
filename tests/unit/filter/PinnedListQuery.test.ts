import { describe, it, expect } from 'vitest';
import { PinnedListQuery } from '../../../src/services/filter/PinnedListQuery';
import { createEmptyFilterState, type FilterState } from '../../../src/services/filter/FilterTypes';
import type { PinnedListDefinition } from '../../../src/types';

const tagIs = (tag: string): FilterState => ({ filters: [{ property: 'tag', operator: 'includes', value: [tag] }], logic: 'and' });
const list = (filterState: FilterState, applyViewFilter: boolean, extra: Partial<PinnedListDefinition> = {}): PinnedListDefinition =>
    ({ id: 'pl', name: 'L', filterState, applyViewFilter, ...extra });

describe('PinnedListQuery.resolve', () => {
    it('with the view filter applied, both filters must pass', () => {
        expect(PinnedListQuery.resolve(list(tagIs('a'), true), tagIs('b')).filter)
            .toEqual({ filters: [tagIs('a'), tagIs('b')], logic: 'and' });
    });

    it('with it off, the list stands alone', () => {
        expect(PinnedListQuery.resolve(list(tagIs('a'), false), tagIs('b')).filter).toEqual(tagIs('a'));
    });

    it('a filter with no condition is left out', () => {
        expect(PinnedListQuery.resolve(list(tagIs('a'), true), createEmptyFilterState()).filter).toEqual(tagIs('a'));
        expect(PinnedListQuery.resolve(list(createEmptyFilterState(), true), tagIs('b')).filter).toEqual(tagIs('b'));
        expect(PinnedListQuery.resolve(list(tagIs('a'), true), undefined).filter).toEqual(tagIs('a'));
    });

    it('carries the list\'s sort', () => {
        const sortState = { rules: [{ property: 'due' as const, direction: 'asc' as const }] };
        expect(PinnedListQuery.resolve(list(tagIs('a'), false, { sortState }), undefined).sort).toBe(sortState);
        expect(PinnedListQuery.resolve(list(tagIs('a'), false), undefined)).not.toHaveProperty('sort');
    });
});
