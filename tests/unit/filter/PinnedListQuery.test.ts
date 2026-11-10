import { describe, it, expect } from 'vitest';
import { PinnedListQuery } from '../../../src/services/filter/PinnedListQuery';
import { createEmptyFilterState, type FilterState } from '../../../src/services/filter/FilterTypes';
import { listFrame, type PinnedListDefinition, type SidebarFrame, type ViewTemplate } from '../../../src/types';
import { TimelineSchema } from '../../../src/views/timelineview/TimelineSchema';
import { CalendarSchema } from '../../../src/views/calendar/CalendarSchema';
import { KanbanSchema } from '../../../src/views/kanban/KanbanSchema';

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

describe("the lists of a view's config (listsOf)", () => {
    const a = list(tagIs('a'), false, { id: 'a', name: 'A' });
    const b = list(tagIs('b'), true, { id: 'b', name: 'B' });
    // A frame that shows something other than a list, as a later kind would be held.
    const other = { kind: 'note', id: 'n', name: 'N' } as unknown as SidebarFrame;

    it("are the list frames of Timeline's and Calendar's sidebar, in their order", () => {
        const pinnedLists = [listFrame(a), other, listFrame(b)];
        expect(TimelineSchema.listsOf?.({ pinnedLists })).toEqual([listFrame(a), listFrame(b)]);
        expect(CalendarSchema.listsOf?.({ pinnedLists })).toEqual([listFrame(a), listFrame(b)]);
        expect(TimelineSchema.listsOf?.({ pinnedLists: [other] })).toEqual([]);
        expect(TimelineSchema.listsOf?.({})).toEqual([]);
        expect(CalendarSchema.listsOf?.({})).toEqual([]);
    });

    it("are Kanban's cells, row by row", () => {
        expect(KanbanSchema.listsOf?.({ grid: [[a], [b]] })).toEqual([a, b]);
    });
});

describe('PinnedListQuery.fromTemplate', () => {
    const stored = (name: string, tag: string) => ({ id: `pl-${name}`, name, filterState: tagIs(tag), applyViewFilter: false });
    const template = (viewType: string, pinnedLists: unknown[]): ViewTemplate =>
        ({ filePath: 'templates/t.md', name: 'T', viewType, config: { pinnedLists } });

    it.each(['timeline', 'calendar'])('names the lists of a %s template whose sidebar holds a frame of another kind too', (viewType) => {
        const t = template(viewType, [
            stored('first', 'a'),
            { kind: 'note', id: 'n', name: 'memo', path: 'Dashboard.md' },
            { kind: 'list', ...stored('second', 'b') },
        ]);
        expect(PinnedListQuery.fromTemplate(t, 'second')).toEqual({ query: { filter: tagIs('b') } });
        const unnamed = PinnedListQuery.fromTemplate(t);
        expect('listError' in unnamed && unnamed.listError('list'))
            .toBe("Template has pinned lists. Name one with 'list': first, second");
        const missing = PinnedListQuery.fromTemplate(t, 'memo');
        expect('listError' in missing && missing.listError('list'))
            .toBe('Pinned list "memo" not found. Available: first, second');
    });
});
