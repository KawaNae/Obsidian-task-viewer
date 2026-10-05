import { describe, it, expect } from 'vitest';
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
import { dayStart, visualDaysOf } from '../../../../src/utils/DayWindow';
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

describe('visual-day split: the head belongs to the day it started on', () => {
    it('startHour=0: a task crossing midnight is drawn up to midnight, then from it', () => {
        const [head, tail] = splitCrosser(0);
        const midnight = dayStart('2026-08-18', 0);
        expect(head.drawn).toEqual({ startMs: head.span!.startMs, endMs: midnight });
        expect(tail.drawn).toEqual({ startMs: midnight, endMs: head.span!.endMs });
    });

    it.each(ALL_START_HOURS)('startHour=%i: a segment keeps its line values and the whole span', (startHour) => {
        const whole = toDisplayTask(makeTask(crosserFor(startHour)), startHour);
        for (const seg of splitCrosser(startHour)) {
            const { startDate, startTime, endDate, endTime } = seg;
            expect({ startDate, startTime, endDate, endTime }).toEqual(crosserFor(startHour));
            expect(seg.span).toEqual(whole.span);
            expect(seg.stated).toEqual(whole.stated);
        }
    });

    it.each(ALL_START_HOURS)('startHour=%i: the head is a timed segment, not an all-day one', (startHour) => {
        const [head, tail] = splitCrosser(startHour);
        expect(classifyForSection(head)).toBe('timed');
        expect(classifyForSection(tail)).toBe('timed');
    });

    it.each(ALL_START_HOURS)('startHour=%i: the head occupies exactly one visual day', (startHour) => {
        const [head] = splitCrosser(startHour);
        const days = visualDaysOf(head.drawn!, startHour);
        expect(days.first).toBe(days.last);
    });

    it.each(ALL_START_HOURS)(
        'startHour=%i: the head ends before the tail begins, on separate visual days',
        (startHour) => {
            // Overlapping visual days send the two segments of one task to
            // different tracks in the greedy layout (0f754e3d). The head ends
            // on the boundary, and the moment before it is its last day.
            const [head, tail] = splitCrosser(startHour);
            expect(visualDaysOf(head.drawn!, startHour).last < visualDaysOf(tail.drawn!, startHour).first).toBe(true);
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
                const r = visualDaysOf(s.drawn!, startHour);
                return { start: r.first, end: r.last };
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
