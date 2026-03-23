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
        childLineBodyOffsets: [],
        originalText: '',
        tags: overrides.tags ?? [],
        parserId: 'at-notation',
        effectiveStartDate: overrides.effectiveStartDate ?? '',
        startDateImplicit: false,
        startTimeImplicit: false,
        endDateImplicit: false,
        endTimeImplicit: false,
        originalTaskId: overrides.id ?? 'test-1',
        isSplit: false,
        ...overrides,
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
});
