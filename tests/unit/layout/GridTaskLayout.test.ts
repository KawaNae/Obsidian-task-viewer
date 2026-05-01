import { describe, it, expect } from 'vitest';
import { computeGridLayout } from '../../../src/views/sharedLogic/GridTaskLayout';
import type { DisplayTask } from '../../../src/types';
import type { GridLayoutConfig, TaskDateRange } from '../../../src/views/sharedLogic/GridTaskLayout';

function makeDT(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return {
        id: overrides.id ?? 'test-1',
        file: overrides.file ?? 'file.md',
        line: overrides.line ?? 0,
        content: overrides.content ?? '',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: '',
        tags: [],
        parserId: 'tv-inline',
        effectiveStartDate: '',
        startDateImplicit: false,
        startTimeImplicit: false,
        endDateImplicit: false,
        endTimeImplicit: false,
        originalTaskId: overrides.id ?? 'test-1',
        isSplit: false,
        ...overrides,
    } as DisplayTask;
}

function makeConfig(dates: string[], ranges: Map<string, TaskDateRange>): GridLayoutConfig {
    return {
        dates,
        getDateRange: (task) => ranges.get(task.id) ?? null,
        computeDueArrows: true,
    };
}

describe('computeGridLayout', () => {
    it('empty dates → empty result', () => {
        expect(computeGridLayout([], { dates: [], getDateRange: () => null })).toEqual([]);
    });

    it('single task, single day', () => {
        const task = makeDT({ id: 'a' });
        const ranges = new Map([['a', { effectiveStart: '2026-03-11', effectiveEnd: '2026-03-11' }]]);
        const config = makeConfig(['2026-03-11'], ranges);
        const result = computeGridLayout([task], config);

        expect(result).toHaveLength(1);
        expect(result[0].colStart).toBe(1);
        expect(result[0].span).toBe(1);
        expect(result[0].isMultiDay).toBe(false);
        expect(result[0].trackIndex).toBe(0);
    });

    it('multi-day task spans columns', () => {
        const task = makeDT({ id: 'a' });
        const dates = ['2026-03-10', '2026-03-11', '2026-03-12'];
        const ranges = new Map([['a', { effectiveStart: '2026-03-10', effectiveEnd: '2026-03-12' }]]);
        const result = computeGridLayout([task], makeConfig(dates, ranges));

        expect(result).toHaveLength(1);
        expect(result[0].colStart).toBe(1);
        expect(result[0].span).toBe(3);
        expect(result[0].isMultiDay).toBe(true);
    });

    it('task outside range is excluded', () => {
        const task = makeDT({ id: 'a' });
        const dates = ['2026-03-10', '2026-03-11'];
        const ranges = new Map([['a', { effectiveStart: '2026-03-20', effectiveEnd: '2026-03-20' }]]);
        const result = computeGridLayout([task], makeConfig(dates, ranges));

        expect(result).toHaveLength(0);
    });

    it('track collision → different trackIndex', () => {
        const tasks = [
            makeDT({ id: 'a', line: 0 }),
            makeDT({ id: 'b', line: 1 }),
        ];
        const dates = ['2026-03-10', '2026-03-11'];
        const ranges = new Map([
            ['a', { effectiveStart: '2026-03-10', effectiveEnd: '2026-03-11' }],
            ['b', { effectiveStart: '2026-03-10', effectiveEnd: '2026-03-11' }],
        ]);
        const result = computeGridLayout(tasks, makeConfig(dates, ranges));

        expect(result).toHaveLength(2);
        const tracks = result.map(r => r.trackIndex);
        expect(tracks).toContain(0);
        expect(tracks).toContain(1);
    });

    it('due arrow when due is after task end', () => {
        const task = makeDT({ id: 'a', due: '2026-03-14' });
        const dates = ['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'];
        const ranges = new Map([['a', { effectiveStart: '2026-03-10', effectiveEnd: '2026-03-11' }]]);
        const result = computeGridLayout([task], makeConfig(dates, ranges));

        expect(result).toHaveLength(1);
        expect(result[0].dueArrow).not.toBeNull();
        expect(result[0].dueArrow!.arrowStartCol).toBe(3); // task ends at col 2, arrow starts at col 3
        expect(result[0].dueArrow!.arrowEndCol).toBe(5); // due is at col 5
        expect(result[0].dueArrow!.isClipped).toBe(false);
    });

    it('due arrow clipped when beyond range', () => {
        const task = makeDT({ id: 'a', due: '2026-03-20' });
        const dates = ['2026-03-10', '2026-03-11'];
        const ranges = new Map([['a', { effectiveStart: '2026-03-10', effectiveEnd: '2026-03-10' }]]);
        const result = computeGridLayout([task], makeConfig(dates, ranges));

        expect(result[0].dueArrow).not.toBeNull();
        expect(result[0].dueArrow!.isClipped).toBe(true);
    });

    it('no due arrow when due is within task span', () => {
        const task = makeDT({ id: 'a', due: '2026-03-10' });
        const dates = ['2026-03-10', '2026-03-11'];
        const ranges = new Map([['a', { effectiveStart: '2026-03-10', effectiveEnd: '2026-03-11' }]]);
        const result = computeGridLayout([task], makeConfig(dates, ranges));

        expect(result[0].dueArrow).toBeNull();
    });

    it('continuesBefore/After for clipped multi-day task', () => {
        const task = makeDT({ id: 'a' });
        const dates = ['2026-03-11', '2026-03-12'];
        const ranges = new Map([['a', { effectiveStart: '2026-03-10', effectiveEnd: '2026-03-14' }]]);
        const result = computeGridLayout([task], makeConfig(dates, ranges));

        expect(result).toHaveLength(1);
        expect(result[0].continuesBefore).toBe(true);
        expect(result[0].continuesAfter).toBe(true);
        expect(result[0].span).toBe(2);
    });
});
