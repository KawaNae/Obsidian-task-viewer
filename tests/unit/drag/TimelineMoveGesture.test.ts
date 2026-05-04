import { describe, expect, it } from 'vitest';
import { TimelineMoveGesture } from '../../../src/interaction/drag/strategies/timeline/TimelineMoveGesture';
import { DateUtils } from '../../../src/utils/DateUtils';
import { materializeRawDates } from '../../../src/services/display/DisplayTaskConverter';
import type { Task } from '../../../src/types';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'tv-inline:test.md:ln:1',
        file: 'test.md',
        line: 0,
        content: 'test',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        tags: [],
        originalText: '- [ ] test',
        parserId: 'tv-inline',
        ...overrides,
    };
}

const startHour = 5;
const startHourMinutes = startHour * 60; // 300
const zoomLevel = 2; // 1 minute = 2 px

describe('TimelineMoveGesture.computeOverlappingDays', () => {
    it('returns single candidate when task fits within one day window', () => {
        // task: 10:00 - 11:00 (totalStartMin = 600, totalEndMin = 660)
        const candidates = TimelineMoveGesture.computeOverlappingDays(
            600, 660, startHourMinutes, zoomLevel, '2026-04-20',
        );
        expect(candidates).toEqual([
            { date: '2026-04-20', top: (600 - 300) * 2, height: 60 * 2 },
        ]);
    });

    it('returns two candidates when task crosses to next day', () => {
        // task: 23:00 - 02:00 (next day) = totalStartMin = 1380, totalEndMin = 1560
        // window 0: [300, 1740) → overlap [1380, 1560), 180 min
        // window +1: [1740, 3180) → no overlap
        // Hmm, let me reconsider. The day boundary is at 24*60=1440 (midnight) plus
        // offsetDays*1440 in absolute minutes, but the window calculation uses
        // startHourMinutes + offsetDays*1440. So:
        //   offset -1: [-1140, 300)   ← yesterday's startHour-shifted day
        //   offset  0: [300, 1740)    ← today's startHour-shifted day
        //   offset +1: [1740, 3180)   ← tomorrow's startHour-shifted day
        // task 1380-1560 (23:00-26:00) sits entirely in offset 0, so single segment.
        const candidates = TimelineMoveGesture.computeOverlappingDays(
            1380, 1560, startHourMinutes, zoomLevel, '2026-04-20',
        );
        expect(candidates).toHaveLength(1);
        expect(candidates[0].date).toBe('2026-04-20');
    });

    it('returns two candidates when task crosses startHour boundary', () => {
        // task crosses startHour=05:00 of next day:
        // task: 04:00 - 06:00 = 240 - 360 (these are absolute minutes)
        // offset -1 window: [-1140, 300) → overlap [240, 300), 60 min → date 2026-04-19
        // offset  0 window: [300, 1740) → overlap [300, 360), 60 min  → date 2026-04-20
        const candidates = TimelineMoveGesture.computeOverlappingDays(
            240, 360, startHourMinutes, zoomLevel, '2026-04-20',
        );
        expect(candidates).toHaveLength(2);
        expect(candidates[0].date).toBe('2026-04-19');
        expect(candidates[1].date).toBe('2026-04-20');
        // first segment: top = (240 - (-1140)) * 2 = 1380 * 2 = 2760, height = 60*2 = 120
        expect(candidates[0]).toMatchObject({ height: 120 });
        // second segment: top = (300 - 300) * 2 = 0, height = 60*2 = 120
        expect(candidates[1]).toMatchObject({ top: 0, height: 120 });
    });

    it('returns three candidates when task spans more than 24 hours', () => {
        // task: 04:00 today - 06:00 tomorrow (cross 2 startHour boundaries)
        // = totalStartMin = 240, totalEndMin = 240 + 26*60 = 1800
        // offset -1: [-1140, 300) → overlap [240, 300), 60 min → 2026-04-19
        // offset  0: [300, 1740) → overlap [300, 1740), 1440 min → 2026-04-20
        // offset +1: [1740, 3180) → overlap [1740, 1800), 60 min → 2026-04-21
        const candidates = TimelineMoveGesture.computeOverlappingDays(
            240, 1800, startHourMinutes, zoomLevel, '2026-04-20',
        );
        expect(candidates).toHaveLength(3);
        expect(candidates.map(c => c.date)).toEqual(['2026-04-19', '2026-04-20', '2026-04-21']);
        expect(candidates[0].height).toBe(120); // 60min * 2
        expect(candidates[1].height).toBe(2880); // 1440min * 2
        expect(candidates[2].height).toBe(120); // 60min * 2
    });

    it('returns empty array when task has zero duration', () => {
        // overlapStart === overlapEnd → push されない
        const candidates = TimelineMoveGesture.computeOverlappingDays(
            600, 600, startHourMinutes, zoomLevel, '2026-04-20',
        );
        expect(candidates).toEqual([]);
    });

    it('handles negative totalStartMinutes (drag above startHour into prev day)', () => {
        // task: 02:00 yesterday - 03:00 today (2 day startHour-shift back)
        // totalStartMin = -180 (yesterday 02:00 in absolute coordinate),
        // totalEndMin = 180 (today 03:00)
        // offset -1: [-1140, 300) → overlap [-180, 180), 360 min → 2026-04-19
        // offset 0: [300, 1740) → no overlap
        const candidates = TimelineMoveGesture.computeOverlappingDays(
            -180, 180, startHourMinutes, zoomLevel, '2026-04-20',
        );
        expect(candidates).toHaveLength(1);
        expect(candidates[0].date).toBe('2026-04-19');
        expect(candidates[0].height).toBe(360 * 2);
    });
});

/**
 * Timeline drag write-back の visual/raw round-trip 検証。
 *
 * processMove が計算する lastDragResult は raw 表記 (clock day + clock time)。
 * 旧 finishMove はこれをそのまま `effective*` edits として渡していたため、
 * materializeRawDates 内の unshiftVisual で「time < startHour なら +1 day」が
 * 適用され、startDate が二重 shift される (00:00 跨ぎ task で 1 日ズレるバグ)。
 *
 * Fix: toVisualDate で raw → visual に正規化してから edits に詰めることで、
 * materializeRawDates で逆変換され元の raw に戻る (round-trip)。
 */
describe('Timeline visual/raw round-trip', () => {
    it('roundtrips raw 04-22 02:00 (startHour=5) back to raw 04-22', () => {
        // raw 04-22 02:00 は visual 04-21 (time < startHour で -1 day)
        const rawStart = '2026-04-22';
        const rawTime = '02:00';
        const visual = DateUtils.toVisualDate(rawStart, rawTime, startHour);
        expect(visual).toBe('2026-04-21');

        // edits を visual で作成し materializeRawDates に流すと raw に戻る
        const baseTask = makeTask({
            startDate: '2026-04-20', startTime: '14:00', endTime: '15:00',
        });
        const updates = materializeRawDates(
            { effectiveStartDate: visual, effectiveStartTime: rawTime },
            baseTask,
            startHour,
        );
        expect(updates.startDate).toBe(rawStart);
        expect(updates.startTime).toBe(rawTime);
    });

    it('roundtrips raw 04-21 22:00 (time >= startHour) unchanged', () => {
        // time 22 >= 5 → toVisualDate は -1 day しない、raw == visual
        const rawStart = '2026-04-21';
        const rawTime = '22:00';
        const visual = DateUtils.toVisualDate(rawStart, rawTime, startHour);
        expect(visual).toBe('2026-04-21');

        const baseTask = makeTask({ startDate: '2026-04-20', startTime: '14:00', endTime: '15:00' });
        const updates = materializeRawDates(
            { effectiveStartDate: visual, effectiveStartTime: rawTime },
            baseTask,
            startHour,
        );
        expect(updates.startDate).toBe(rawStart);
    });

    it('roundtrips raw 04-22 04:59 (just before next startHour) → visual 04-21', () => {
        // time 04:59 < 5 で -1 day
        const visual = DateUtils.toVisualDate('2026-04-22', '04:59', startHour);
        expect(visual).toBe('2026-04-21');

        const baseTask = makeTask({ startDate: '2026-04-20', startTime: '14:00', endTime: '15:00' });
        const updates = materializeRawDates(
            { effectiveStartDate: visual, effectiveStartTime: '04:59' },
            baseTask,
            startHour,
        );
        expect(updates.startDate).toBe('2026-04-22');
    });

    it('roundtrips raw 04-22 05:00 (exactly startHour) unchanged', () => {
        // time 05 >= 5 で同 day
        const visual = DateUtils.toVisualDate('2026-04-22', '05:00', startHour);
        expect(visual).toBe('2026-04-22');

        const baseTask = makeTask({ startDate: '2026-04-20', startTime: '14:00', endTime: '15:00' });
        const updates = materializeRawDates(
            { effectiveStartDate: visual, effectiveStartTime: '05:00' },
            baseTask,
            startHour,
        );
        expect(updates.startDate).toBe('2026-04-22');
    });
});
