import { describe, it, expect } from 'vitest';
import {
    gridEnd, gridOfMonth, gridShifted, gridStart, monthGridStartOf, pickerDay, referenceMonth, weekStartOf,
} from '../../../../src/views/calendar/CalendarGrid';
import { followToday } from '../../../../src/views/base/ViewedDay';
import { CalendarCodec } from '../../../../src/views/calendar/CalendarSchema';
import { MiniCalendarCodec } from '../../../../src/views/calendar/MiniCalendarSchema';
import { resetPatch } from '../../../../src/views/base/ViewSettings';

// 2026-10-01 is a Thursday, 2026-11-01 a Sunday.
const TODAY = '2026-10-03';

describe('the grid Calendar and MiniCalendar draw', () => {
    it('follows today: the month grid of today, from the week of the 1st', () => {
        expect(gridStart(undefined, TODAY, 0)).toBe('2026-09-27');
        expect(gridStart(undefined, TODAY, 1)).toBe('2026-09-28');
        expect(gridStart(undefined, TODAY, 0)).toBe(monthGridStartOf(TODAY, 0));
    });

    it('a fixed date puts its week on the top row', () => {
        expect(gridStart('2026-10-14', TODAY, 0)).toBe('2026-10-11');
        expect(gridStart('2026-10-14', TODAY, 1)).toBe('2026-10-12');
    });

    it('reads the week start of the settings each time, so a change of it shows at once', () => {
        const date = '2026-10-11'; // a Sunday, saved as a grid start with weeks from Sunday
        expect(gridStart(date, TODAY, 0)).toBe('2026-10-11');
        expect(gridStart(date, TODAY, 1)).toBe('2026-10-05');
        expect(weekStartOf(date, 1)).toBe('2026-10-05');
    });

    it('holds six weeks', () => {
        expect(gridEnd('2026-09-27')).toBe('2026-11-07');
    });

    it('is read as the month of its middle, and the date picker opens on its 1st', () => {
        expect(referenceMonth('2026-09-27')).toEqual({ year: 2026, month: 9 });
        expect(pickerDay('2026-09-27')).toBe('2026-10-01');
        expect(pickerDay(gridStart('2026-10-14', TODAY, 0))).toBe('2026-10-01');
    });
});

describe('moving the grid', () => {
    it('Today clears the date: the view follows today again', () => {
        expect(followToday()).toEqual({ date: undefined });
    });

    it('go to a day fixes the date on the start of its month grid', () => {
        expect(gridOfMonth('2026-11-15', 0)).toEqual({ date: '2026-11-01' });
        expect(gridOfMonth('2026-11-15', 1)).toEqual({ date: '2026-10-26' });
        // The grid drawn is then that month's grid.
        expect(gridStart(gridOfMonth('2026-11-15', 1).date, TODAY, 1)).toBe('2026-10-26');
    });

    it('the arrows move the grid drawn by weeks and fix the date on its new first day', () => {
        expect(gridShifted(undefined, TODAY, 0, 1)).toEqual({ date: '2026-10-04' });
        expect(gridShifted(undefined, TODAY, 0, -2)).toEqual({ date: '2026-09-13' });
        expect(gridShifted('2026-10-14', TODAY, 0, 1)).toEqual({ date: '2026-10-18' });
        // A week up after a week down is the grid it left.
        const down = gridShifted(undefined, TODAY, 1, 1).date;
        expect(gridShifted(down, TODAY, 1, -1)).toEqual({ date: gridStart(undefined, TODAY, 1) });
    });

    it('when the day rolls, a following grid moves to the new today, a fixed one stays', () => {
        expect(gridStart(undefined, '2026-10-31', 0)).toBe('2026-09-27');
        expect(gridStart(undefined, '2026-11-01', 0)).toBe('2026-11-01');
        expect(gridStart('2026-10-11', '2026-10-31', 0)).toBe('2026-10-11');
        expect(gridStart('2026-10-11', '2026-11-01', 0)).toBe('2026-10-11');
    });
});

describe('the saved date', () => {
    it('is read from date on restore, and the older windowStart is not read', () => {
        for (const codec of [CalendarCodec, MiniCalendarCodec]) {
            expect(codec.parseTransient({ date: '2026-10-11' })).toMatchObject({ date: '2026-10-11' });
            expect(codec.parseTransient({ windowStart: '2026-10-11' }).date).toBeUndefined();
            expect(codec.serializeTransient({ date: '2026-10-11' })).toMatchObject({ date: '2026-10-11' });
            expect(codec.schema.anchorKey).toBe('date');
        }
    });

    it('is where the view is, so a reset keeps it', () => {
        expect('date' in resetPatch(CalendarCodec)).toBe(false);
        expect('date' in resetPatch(MiniCalendarCodec)).toBe(false);
    });
});
