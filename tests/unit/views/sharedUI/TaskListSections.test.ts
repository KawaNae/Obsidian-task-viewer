import { describe, it, expect } from 'vitest';
import { copyOfList, newList } from '../../../../src/views/sharedUI/TaskListSections';
import { newListId } from '../../../../src/services/viewConfig/ListIds';
import { createDefaultListFilterState } from '../../../../src/services/filter/FilterTypes';
import type { PinnedListDefinition } from '../../../../src/types';

describe('a new list', () => {
    it('shows every task that is not a child, alone, under an id no other list has', () => {
        const a = newList();
        const b = newList();
        expect(a.filterState).toEqual(createDefaultListFilterState());
        expect(a.applyViewFilter).toBe(false);
        expect(a.id).not.toBe(b.id);
    });

    it('ids differ when made in the same millisecond', () => {
        const ids = new Set(Array.from({ length: 50 }, () => newListId()));
        expect(ids.size).toBe(50);
    });
});

describe('a copy of a list', () => {
    const list: PinnedListDefinition = {
        id: 'list-a',
        name: 'Today',
        filterState: { filters: [{ property: 'status', operator: 'includes', value: [' '] }], logic: 'and' },
        sortState: { rules: [{ id: 'r', property: 'due', direction: 'asc' }] },
        applyViewFilter: true,
        topRight: { fields: ['due'], separator: ' ' },
    } as PinnedListDefinition;

    it('has a new id and a name marked as a copy, and the same query and top right', () => {
        const copy = copyOfList(list);
        expect(copy.id).not.toBe(list.id);
        expect(copy.name).toBe('Today (copy)');
        expect(copy.filterState).toEqual(list.filterState);
        expect(copy.sortState).toEqual(list.sortState);
        expect(copy.applyViewFilter).toBe(true);
        expect(copy.topRight).toEqual(list.topRight);
    });

    it('leaves the list it was made of as it was', () => {
        const before = JSON.stringify(list);
        copyOfList(list);
        expect(JSON.stringify(list)).toBe(before);
    });
});
