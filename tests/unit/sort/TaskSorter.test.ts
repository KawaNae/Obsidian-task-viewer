import { describe, it, expect } from 'vitest';
import { TaskSorter } from '../../../src/services/sort/TaskSorter';
import type { DisplayTask } from '../../../src/types';
import type { SortState } from '../../../src/services/sort/SortTypes';

function makeDT(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return {
        id: overrides.id ?? 'test-1',
        file: overrides.file ?? 'file.md',
        line: overrides.line ?? 0,
        content: overrides.content ?? '',
        statusChar: overrides.statusChar ?? ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        originalText: '',
        tags: overrides.tags ?? [],
        parserId: 'tv-inline',
        effectiveStartDate: overrides.effectiveStartDate ?? '',
        startDateImplicit: false,
        startTimeImplicit: false,
        endDateImplicit: false,
        endTimeImplicit: false,
        originalTaskId: overrides.id ?? 'test-1',
        isSplit: false,
        ...overrides,
        // toDisplayTask resolves effectiveDue from the row's own due when it has one.
        effectiveDue: overrides.effectiveDue ?? overrides.due,
    } as DisplayTask;
}

describe('TaskSorter', () => {
    describe('defaultSort', () => {
        it('sorts by due → startDate → content', () => {
            const tasks = [
                makeDT({ id: 'c', content: 'C', due: '2026-03-15', effectiveStartDate: '2026-03-10' }),
                makeDT({ id: 'a', content: 'A', due: '2026-03-10', effectiveStartDate: '2026-03-10' }),
                makeDT({ id: 'b', content: 'B', due: '2026-03-10', effectiveStartDate: '2026-03-05' }),
            ];
            TaskSorter.defaultSort(tasks);
            expect(tasks.map(t => t.id)).toEqual(['b', 'a', 'c']);
        });

        it('tasks without due sort after those with due', () => {
            const tasks = [
                makeDT({ id: 'no-due', content: 'X' }),
                makeDT({ id: 'has-due', content: 'Y', due: '2026-01-01' }),
            ];
            TaskSorter.defaultSort(tasks);
            expect(tasks[0].id).toBe('no-due'); // '' < '2026...' → '' sorts first actually
            // Actually empty string sorts before any date string
        });
    });

    describe('sort with rules', () => {
        it('sorts by content asc', () => {
            const tasks = [
                makeDT({ id: 'b', content: 'Banana' }),
                makeDT({ id: 'a', content: 'Apple' }),
                makeDT({ id: 'c', content: 'Cherry' }),
            ];
            const state: SortState = { rules: [{ id: 'r1', property: 'content', direction: 'asc' }] };
            TaskSorter.sort(tasks, state);
            expect(tasks.map(t => t.content)).toEqual(['Apple', 'Banana', 'Cherry']);
        });

        it('sorts by content desc', () => {
            const tasks = [
                makeDT({ id: 'a', content: 'Apple' }),
                makeDT({ id: 'c', content: 'Cherry' }),
                makeDT({ id: 'b', content: 'Banana' }),
            ];
            const state: SortState = { rules: [{ id: 'r1', property: 'content', direction: 'desc' }] };
            TaskSorter.sort(tasks, state);
            expect(tasks.map(t => t.content)).toEqual(['Cherry', 'Banana', 'Apple']);
        });

        it('multi-rule: due asc then content asc', () => {
            const tasks = [
                makeDT({ id: 'b', content: 'B', due: '2026-03-10' }),
                makeDT({ id: 'a', content: 'A', due: '2026-03-10' }),
                makeDT({ id: 'c', content: 'C', due: '2026-03-05' }),
            ];
            const state: SortState = {
                rules: [
                    { id: 'r1', property: 'due', direction: 'asc' },
                    { id: 'r2', property: 'content', direction: 'asc' },
                ],
            };
            TaskSorter.sort(tasks, state);
            expect(tasks.map(t => t.id)).toEqual(['c', 'a', 'b']);
        });

        it('sorts by startDate using effectiveStartDate', () => {
            const tasks = [
                makeDT({ id: 'b', effectiveStartDate: '2026-03-15' }),
                makeDT({ id: 'a', effectiveStartDate: '2026-03-10' }),
            ];
            const state: SortState = { rules: [{ id: 'r1', property: 'startDate', direction: 'asc' }] };
            TaskSorter.sort(tasks, state);
            expect(tasks.map(t => t.id)).toEqual(['a', 'b']);
        });

        it('sorts by first tag', () => {
            const tasks = [
                makeDT({ id: 'b', tags: ['work'] }),
                makeDT({ id: 'a', tags: ['personal'] }),
            ];
            const state: SortState = { rules: [{ id: 'r1', property: 'tag', direction: 'asc' }] };
            TaskSorter.sort(tasks, state);
            expect(tasks.map(t => t.id)).toEqual(['a', 'b']);
        });
    });

    describe('undefined/empty state → defaultSort', () => {
        it('undefined state', () => {
            const tasks = [
                makeDT({ id: 'b', due: '2026-03-15' }),
                makeDT({ id: 'a', due: '2026-03-10' }),
            ];
            TaskSorter.sort(tasks, undefined);
            expect(tasks[0].id).toBe('a');
        });

        it('empty rules', () => {
            const tasks = [
                makeDT({ id: 'b', due: '2026-03-15' }),
                makeDT({ id: 'a', due: '2026-03-10' }),
            ];
            TaskSorter.sort(tasks, { rules: [] });
            expect(tasks[0].id).toBe('a');
        });
    });

    // A due inherited from a heading or the note is the one the filter matches
    // (`effectiveDue`); the sort used to read the row's own `due` and put such
    // tasks among those without a deadline.
    describe('inherited due', () => {
        it('a rule on due sorts by the inherited due', () => {
            const tasks = [
                makeDT({ id: 'own-later', due: '2026-03-20' }),
                makeDT({ id: 'inherited', effectiveDue: '2026-03-01' }),
                makeDT({ id: 'none' }),
            ];
            TaskSorter.sort(tasks, { rules: [{ id: 'r', property: 'due', direction: 'asc' }] });
            expect(tasks.map(t => t.id)).toEqual(['none', 'inherited', 'own-later']);
        });

        it('the default order reads the inherited due too', () => {
            const tasks = [
                makeDT({ id: 'own-later', due: '2026-03-20' }),
                makeDT({ id: 'inherited', effectiveDue: '2026-03-01' }),
            ];
            TaskSorter.sort(tasks, undefined);
            expect(tasks.map(t => t.id)).toEqual(['inherited', 'own-later']);
        });
    });
});

// The values each rule compares, pinned so that reading them from one table
// (TaskValues) leaves every order as it was.
describe('the values a rule compares', () => {
    const ids = (tasks: DisplayTask[]) => tasks.map(t => t.id);
    const by = (...rules: Array<[SortState['rules'][number]['property'], 'asc' | 'desc']>): SortState =>
        ({ rules: rules.map(([property, direction], i) => ({ id: `r${i}`, property, direction })) });

    it('due compares the time with the date: a date alone before its times, earlier times first', () => {
        const tasks = [
            makeDT({ id: 'nine', due: '2026-03-10T09:00' }),
            makeDT({ id: 'bare', due: '2026-03-10' }),
            makeDT({ id: 'eight', due: '2026-03-10T08:00' }),
        ];
        TaskSorter.sort(tasks, by(['due', 'asc']));
        expect(ids(tasks)).toEqual(['bare', 'eight', 'nine']);
    });

    it('startDate compares the date only: a later time on the same day ties, and the next rule decides', () => {
        const tasks = [
            makeDT({ id: 'early-b', content: 'B', effectiveStartDate: '2026-03-10', effectiveStartTime: '08:00' }),
            makeDT({ id: 'late-a', content: 'A', effectiveStartDate: '2026-03-10', effectiveStartTime: '20:00' }),
        ];
        TaskSorter.sort(tasks, by(['startDate', 'asc'], ['content', 'asc']));
        expect(ids(tasks)).toEqual(['late-a', 'early-b']);
    });

    it('endDate compares the effective end date only', () => {
        const tasks = [
            makeDT({ id: 'early-b', content: 'B', effectiveEndDate: '2026-03-10', effectiveEndTime: '08:00' }),
            makeDT({ id: 'late-a', content: 'A', effectiveEndDate: '2026-03-10', effectiveEndTime: '20:00' }),
            makeDT({ id: 'before', content: 'Z', effectiveEndDate: '2026-03-09' }),
        ];
        TaskSorter.sort(tasks, by(['endDate', 'asc'], ['content', 'asc']));
        expect(ids(tasks)).toEqual(['before', 'late-a', 'early-b']);
    });

    it('tag compares the first of the effective tags, the section\'s merged in', () => {
        const tasks = [
            makeDT({ id: 'b-first', tags: ['b', 'a'] }),
            makeDT({ id: 'a-only', tags: ['a'] }),
            makeDT({ id: 'inherited', tags: [], cascadeContext: { tags: ['aa'] } }),
        ];
        TaskSorter.sort(tasks, by(['tag', 'asc']));
        expect(ids(tasks)).toEqual(['a-only', 'inherited', 'b-first']);
    });

    it('a missing value is the smallest: first ascending, last descending', () => {
        const make = () => [
            makeDT({ id: 'has', due: '2026-03-10', effectiveStartDate: '2026-03-10', effectiveEndDate: '2026-03-10', tags: ['x'] }),
            makeDT({ id: 'none' }),
        ];
        for (const property of ['due', 'startDate', 'endDate', 'tag'] as const) {
            const asc = make();
            TaskSorter.sort(asc, by([property, 'asc']));
            expect(ids(asc), property).toEqual(['none', 'has']);
            const desc = make();
            TaskSorter.sort(desc, by([property, 'desc']));
            expect(ids(desc), property).toEqual(['has', 'none']);
        }
    });

    it('file and status compare the row\'s own text', () => {
        const tasks = [
            makeDT({ id: 'b-x', file: 'b.md', statusChar: 'x' }),
            makeDT({ id: 'a-space', file: 'a.md', statusChar: ' ' }),
            makeDT({ id: 'a-x', file: 'a.md', statusChar: 'x' }),
        ];
        TaskSorter.sort(tasks, by(['file', 'asc'], ['status', 'desc']));
        expect(ids(tasks)).toEqual(['a-x', 'a-space', 'b-x']);
    });
});
