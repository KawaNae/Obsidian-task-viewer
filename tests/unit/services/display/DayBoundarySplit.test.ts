import { describe, it, expect } from 'vitest';
import { dayBoundaryAt } from '../../../../src/services/display/DayBoundary';
import {
    shouldSplitDisplayTask,
    splitDisplayTaskAtBoundary,
    toDisplayTask,
} from '../../../../src/services/display/DisplayTaskConverter';
import { classifyForSection } from '../../../../src/services/display/SectionClassifier';
import {
    categorizeTasksByDate,
    categorizeTasksForDate,
} from '../../../../src/services/display/TaskDateCategorizer';
import { splitTasks } from '../../../../src/services/display/TaskSplitter';
import { getTaskDateRange } from '../../../../src/services/display/VisualDateRange';
import type { DisplayTask, Task } from '../../../../src/types';
import { makeTask } from '../../helpers/makeTask';

const ALL_START_HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * A 45-minute task that crosses `startHour`'s boundary: it starts 30 minutes
 * before and ends 15 minutes after. At startHour=0 that means crossing
 * midnight, which is the case that used to disappear.
 */
function crosserFor(startHour: number): Partial<Task> {
    if (startHour === 0) {
        return { startDate: '2026-08-17', startTime: '23:30', endDate: '2026-08-18', endTime: '00:15' };
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
        startDate: '2026-08-18',
        startTime: `${pad(startHour - 1)}:30`,
        endDate: '2026-08-18',
        endTime: `${pad(startHour)}:15`,
    };
}

function splitCrosser(startHour: number): [DisplayTask, DisplayTask] {
    const dt = toDisplayTask(makeTask(crosserFor(startHour)), startHour);
    expect(shouldSplitDisplayTask(dt, startHour)).toBe(true);
    return splitDisplayTaskAtBoundary(dt, startHour);
}

describe('dayBoundaryAt', () => {
    it('the minute before midnight is on the previous date', () => {
        expect(dayBoundaryAt('2026-08-18', 0)).toEqual({
            date: '2026-08-18', time: '00:00',
            beforeDate: '2026-08-17', beforeTime: '23:59',
        });
    });

    it('the minute before any other boundary is on the same date', () => {
        expect(dayBoundaryAt('2026-08-18', 5)).toEqual({
            date: '2026-08-18', time: '05:00',
            beforeDate: '2026-08-18', beforeTime: '04:59',
        });
    });

    it('boundary and the minute before it are always one minute apart', () => {
        for (const startHour of ALL_START_HOURS) {
            const b = dayBoundaryAt('2026-08-18', startHour);
            const gap = Date.parse(`${b.date}T${b.time}`) - Date.parse(`${b.beforeDate}T${b.beforeTime}`);
            expect({ startHour, gap }).toEqual({ startHour, gap: 60_000 });
        }
    });
});

describe('visual-day split: the head belongs to the day it started on', () => {
    it('startHour=0: a task crossing midnight ends at 23:59 of the day it began', () => {
        const [head, tail] = splitCrosser(0);

        expect(`${head.effectiveEndDate} ${head.effectiveEndTime}`).toBe('2026-08-17 23:59');
        expect(`${tail.effectiveStartDate} ${tail.effectiveStartTime}`).toBe('2026-08-18 00:00');
        // Same values on the raw fields, which the write-back layer reads.
        expect(`${head.endDate} ${head.endTime}`).toBe('2026-08-17 23:59');
    });

    it('startHour=0: the head is a timed segment, not a 24-hour all-day one', () => {
        // A head carried a day too far measured 24.5h, which is past the 23.5h
        // all-day threshold. The timeline column only reads the timed bucket,
        // so the segment was dropped from the grid entirely.
        const [head] = splitCrosser(0);
        expect(classifyForSection(head, 0)).toBe('timed');
    });

    it.each(ALL_START_HOURS)('startHour=%i: the head occupies exactly one visual day', (startHour) => {
        const [head] = splitCrosser(startHour);
        const range = getTaskDateRange(head, startHour);
        expect(range.effectiveStart).toBe(range.effectiveEnd);
    });

    it.each(ALL_START_HOURS)(
        'startHour=%i: the head ends before the tail begins, on separate visual days',
        (startHour) => {
            // The reason the head ends a minute short of the boundary rather
            // than on it (0f754e3d): overlapping visual days send the two
            // segments of one task to different tracks in the greedy layout.
            const [head, tail] = splitCrosser(startHour);
            const headRange = getTaskDateRange(head, startHour);
            const tailRange = getTaskDateRange(tail, startHour);
            expect(headRange.effectiveEnd! < tailRange.effectiveStart!).toBe(true);
        });
});

describe('timeline placement (GridRenderer path)', () => {
    const dates = ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19'];

    it.each(ALL_START_HOURS)('startHour=%i: both segments land in a timed column', (startHour) => {
        const dt = toDisplayTask(makeTask(crosserFor(startHour)), startHour);
        const segs = splitTasks([dt], { type: 'visual-date', startHour });
        const map = categorizeTasksByDate(segs, dates, startHour);

        const head = dates.find(d => map.get(d)!.timed.some(s => s.splitContinuesAfter));
        const tail = dates.find(d => map.get(d)!.timed.some(s => s.splitContinuesBefore));
        expect({ head, tail }).toEqual({ head: '2026-08-17', tail: '2026-08-18' });
    });

    it.each(ALL_START_HOURS)('startHour=%i: no segment leaks into an all-day bucket', (startHour) => {
        const dt = toDisplayTask(makeTask(crosserFor(startHour)), startHour);
        const segs = splitTasks([dt], { type: 'visual-date', startHour });
        const map = categorizeTasksByDate(segs, dates, startHour);
        expect(dates.flatMap(d => map.get(d)!.allDay)).toEqual([]);
    });
});

describe('single-date placement (ScheduleView path)', () => {
    it('startHour=0: the previous day shows the head as a timed row', () => {
        // Misdated, the head classified as all-day and turned up as an all-day
        // row on both days instead of a timed row on one.
        const dt = toDisplayTask(makeTask(crosserFor(0)), 0);
        const segs = splitTasks([dt], { type: 'visual-date', startHour: 0 });

        const prev = categorizeTasksForDate(segs, '2026-08-17', 0);
        const next = categorizeTasksForDate(segs, '2026-08-18', 0);

        expect({ timed: prev.timed.length, allDay: prev.allDay.length }).toEqual({ timed: 1, allDay: 0 });
        expect({ timed: next.timed.length, allDay: next.allDay.length }).toEqual({ timed: 1, allDay: 0 });
    });
});

describe('date-range clipping (AllDay lane / Calendar path)', () => {
    const RANGE = { start: '2026-08-16', end: '2026-08-22' };

    function clip(task: Partial<Task>, startHour: number) {
        const dt = toDisplayTask(makeTask(task), startHour);
        return splitTasks([dt], { type: 'date-range', startHour, ...RANGE })
            .map(s => {
                const r = getTaskDateRange(s, startHour);
                return { start: r.effectiveStart, end: r.effectiveEnd };
            });
    }

    it.each(ALL_START_HOURS)(
        'startHour=%i: a task running past the end stops at the last day in range',
        (startHour) => {
            const [inRange, after] = clip(
                { startDate: '2026-08-18', startTime: '10:00', endDate: '2026-08-25', endTime: '12:00' },
                startHour);
            expect(inRange.end).toBe(RANGE.end);
            expect(after.start! > RANGE.end).toBe(true);
        });

    it.each(ALL_START_HOURS)(
        'startHour=%i: a task running in from before stops the day before the range',
        (startHour) => {
            const [before, inRange] = clip(
                { startDate: '2026-08-14', startTime: '10:00', endDate: '2026-08-22', endTime: '12:00' },
                startHour);
            expect(before.end! < RANGE.start).toBe(true);
            expect(inRange.start).toBe(RANGE.start);
        });
});
