import { describe, it, expect } from 'vitest';
import { ScheduleOverlapLayout } from '../../src/views/scheduleview/utils/ScheduleOverlapLayout';
import type { DisplayTask } from '../../src/types';
import type { TimedDisplayTask } from '../../src/views/scheduleview/ScheduleTypes';

function makeTimed(id: string, startMin: number, endMin: number): TimedDisplayTask {
    return {
        id,
        file: 'file.md',
        line: 0,
        content: id,
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: '',
        tags: [],
        parserId: 'at-notation',
        effectiveStartDate: '2026-03-11',
        startDateImplicit: false,
        startTimeImplicit: false,
        endDateImplicit: false,
        endTimeImplicit: false,
        originalTaskId: id,
        isSplit: false,
        visualStartMinute: startMin,
        visualEndMinute: endMin,
    } as TimedDisplayTask;
}

describe('ScheduleOverlapLayout', () => {
    const layout = new ScheduleOverlapLayout();

    describe('buildOverlapClusters', () => {
        it('no overlap → separate clusters', () => {
            const tasks = [
                makeTimed('a', 60, 120),   // 1:00–2:00
                makeTimed('b', 180, 240),  // 3:00–4:00
            ];
            const clusters = layout.buildOverlapClusters(tasks);
            expect(clusters).toHaveLength(2);
            expect(clusters[0]).toHaveLength(1);
            expect(clusters[1]).toHaveLength(1);
        });

        it('overlapping tasks → same cluster', () => {
            const tasks = [
                makeTimed('a', 60, 120),   // 1:00–2:00
                makeTimed('b', 90, 150),   // 1:30–2:30
            ];
            const clusters = layout.buildOverlapClusters(tasks);
            expect(clusters).toHaveLength(1);
            expect(clusters[0]).toHaveLength(2);
        });

        it('touching tasks (end == start) → separate clusters', () => {
            const tasks = [
                makeTimed('a', 60, 120),   // 1:00–2:00
                makeTimed('b', 120, 180),  // 2:00–3:00
            ];
            const clusters = layout.buildOverlapClusters(tasks);
            expect(clusters).toHaveLength(2);
        });

        it('chain overlap → all in one cluster', () => {
            const tasks = [
                makeTimed('a', 60, 120),
                makeTimed('b', 100, 180),
                makeTimed('c', 150, 240),
            ];
            const clusters = layout.buildOverlapClusters(tasks);
            expect(clusters).toHaveLength(1);
            expect(clusters[0]).toHaveLength(3);
        });

        it('empty input → empty output', () => {
            expect(layout.buildOverlapClusters([])).toEqual([]);
        });
    });

    describe('assignClusterColumns', () => {
        it('single task → column 0, columnCount 1', () => {
            const cluster = [makeTimed('a', 60, 120)];
            const result = layout.assignClusterColumns(cluster);
            expect(result).toHaveLength(1);
            expect(result[0].column).toBe(0);
            expect(result[0].columnCount).toBe(1);
        });

        it('two overlapping → 2 columns', () => {
            const cluster = [
                makeTimed('a', 60, 120),
                makeTimed('b', 90, 150),
            ];
            const result = layout.assignClusterColumns(cluster);
            expect(result).toHaveLength(2);
            const cols = result.map(r => r.column);
            expect(cols).toContain(0);
            expect(cols).toContain(1);
            expect(result[0].columnCount).toBe(2);
        });

        it('sequential within cluster reuses column', () => {
            const cluster = [
                makeTimed('a', 60, 120),
                makeTimed('b', 60, 180),  // overlaps a
                makeTimed('c', 120, 180), // after a, can reuse col 0
            ];
            const result = layout.assignClusterColumns(cluster);
            // a→col0, b→col1, c→col0 (reuses a's column)
            const aCol = result.find(r => r.task.id === 'a')!.column;
            const cCol = result.find(r => r.task.id === 'c')!.column;
            expect(aCol).toBe(cCol);
        });
    });
});
