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

    it('split segments of same originalTaskId share the same track', () => {
        // 同 task の 2 segments の間に他 task の segment が割り込んだとき、後続
        // segment が空き track に飛んで上下にずれない (originalTaskId lock)。
        // dump 再現: A_seg1 (task A, cs=2 sp=4), B_seg1 (task B, cs=2 sp=3),
        // C_seg1 (task C, cs=3 sp=3), A_seg2 (task A, cs=6 sp=1), C_seg2 (task C, cs=6 sp=1)
        const tasks = [
            makeDT({ id: 'A_seg1', originalTaskId: 'A', file: 'a.md', line: 0 }),
            makeDT({ id: 'B_seg1', originalTaskId: 'B', file: 'b.md', line: 0 }),
            makeDT({ id: 'C_seg1', originalTaskId: 'C', file: 'c.md', line: 0 }),
            makeDT({ id: 'A_seg2', originalTaskId: 'A', file: 'a.md', line: 0 }),
            makeDT({ id: 'C_seg2', originalTaskId: 'C', file: 'c.md', line: 0 }),
        ];
        const dates = ['1', '2', '3', '4', '5', '6'];
        const ranges = new Map<string, TaskDateRange>([
            ['A_seg1', { effectiveStart: '2', effectiveEnd: '5' }], // cs=2, sp=4
            ['B_seg1', { effectiveStart: '2', effectiveEnd: '4' }], // cs=2, sp=3
            ['C_seg1', { effectiveStart: '3', effectiveEnd: '5' }], // cs=3, sp=3
            ['A_seg2', { effectiveStart: '6', effectiveEnd: '6' }], // cs=6, sp=1
            ['C_seg2', { effectiveStart: '6', effectiveEnd: '6' }], // cs=6, sp=1
        ]);
        const result = computeGridLayout(tasks, makeConfig(dates, ranges));

        const trackOf = (id: string) =>
            result.find(r => r.task.id === id)!.trackIndex;

        // 同じ originalTaskId の segments は同じ track に
        expect(trackOf('A_seg1')).toBe(trackOf('A_seg2'));
        expect(trackOf('C_seg1')).toBe(trackOf('C_seg2'));
        // 異なる task の segments は別 track でも可 (重なるなら別 track)
        expect(trackOf('A_seg1')).not.toBe(trackOf('B_seg1'));
    });

    it('locked track falls back to first-fit when occupied at second segment', () => {
        // locked track が後続 segment の colStart までに別 task で footprint 上書き
        // されているケース: lock を諦めて新規 / 別の空き track に乗せる。
        const tasks = [
            makeDT({ id: 'A_seg1', originalTaskId: 'A', file: 'a.md', line: 0 }),
            makeDT({ id: 'X', originalTaskId: 'X', file: 'x.md', line: 0 }),
            makeDT({ id: 'A_seg2', originalTaskId: 'A', file: 'a.md', line: 0 }),
        ];
        const dates = ['1', '2', '3', '4', '5'];
        const ranges = new Map<string, TaskDateRange>([
            ['A_seg1', { effectiveStart: '1', effectiveEnd: '1' }], // cs=1, sp=1, fp=1
            // X covers track 0 from col 2 to col 5, blocking A_seg2 from reusing track 0
            ['X', { effectiveStart: '2', effectiveEnd: '5' }],     // cs=2, sp=4, fp=5
            ['A_seg2', { effectiveStart: '4', effectiveEnd: '4' }], // cs=4, sp=1
        ]);
        const result = computeGridLayout(tasks, makeConfig(dates, ranges));

        const trackOf = (id: string) =>
            result.find(r => r.task.id === id)!.trackIndex;

        // A_seg1 は track 0 (空)、X は cs=2 で track 0 が空 (fp=1 < 2) なので track 0
        // → tracks=[5]。A_seg2 は lock=track 0 だが tracks[0]=5 ≥ 4 で再利用不可
        // → first-fit で新規 track 1 にフォールバック
        expect(trackOf('A_seg1')).toBe(0);
        expect(trackOf('X')).toBe(0);
        expect(trackOf('A_seg2')).toBe(1);
    });
});
