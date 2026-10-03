import { describe, it, expect } from 'vitest';
import {
    gridAt, gridFollowingToday, gridRange, gridShifted, referenceMonth, weekStartOf,
} from '../../../../src/views/calendar/CalendarGrid';
import { CalendarCodec } from '../../../../src/views/calendar/CalendarSchema';
import { MiniCalendarCodec } from '../../../../src/views/calendar/MiniCalendarSchema';
import { resetPatch } from '../../../../src/views/base/ViewSettings';
import { DateUtils } from '../../../../src/utils/DateUtils';

// 2026-10-01 is a Thursday, 2026-11-01 a Sunday, 2026-12-01 a Tuesday.
const TODAY = '2026-10-03';

describe('the grid Calendar and MiniCalendar draw', () => {
    it("follows today: today's month grid, from the week of the 1st, six weeks", () => {
        expect(gridRange({}, TODAY, 0)).toEqual({ start: '2026-09-27', end: '2026-11-07' });
        expect(gridRange({}, TODAY, 1)).toEqual({ start: '2026-09-28', end: '2026-11-08' });
    });

    it("a date shows its month's grid, wherever in the month it is", () => {
        for (const date of ['2026-11-01', '2026-11-15', '2026-11-30']) {
            expect(gridRange({ date }, TODAY, 0).start).toBe('2026-11-01');
            expect(gridRange({ date }, TODAY, 1).start).toBe('2026-10-26');
        }
    });

    it('moves the month grid by the offset, either way and across months', () => {
        expect(gridRange({ date: '2026-11-15', weekOffset: 1 }, TODAY, 0).start).toBe('2026-11-08');
        expect(gridRange({ date: '2026-11-15', weekOffset: -2 }, TODAY, 0).start).toBe('2026-10-18');
        expect(gridRange({ date: '2026-11-15', weekOffset: 5 }, TODAY, 1).start).toBe('2026-11-30');
        expect(gridRange({ date: '2026-12-20', weekOffset: 3 }, TODAY, 0)).toEqual({ start: '2026-12-20', end: '2027-01-30' });
        // While following, the offset is laid on today's month grid.
        expect(gridRange({ weekOffset: 1 }, TODAY, 0).start).toBe('2026-10-04');
    });

    it('reads the week start each time, so a month grid stays on its month when it changes', () => {
        const position = { date: '2026-12-15' };
        expect(gridRange(position, TODAY, 0).start).toBe('2026-11-29');
        expect(gridRange(position, TODAY, 1).start).toBe('2026-11-30');
        // Both top rows hold the 1st.
        for (const ws of [0, 1] as const) {
            const { start } = gridRange(position, TODAY, ws);
            expect(weekStartOf('2026-12-01', ws)).toBe(start);
        }
    });

    it('is read as the month of its middle: with no offset, the month of the date', () => {
        expect(referenceMonth(gridRange({}, TODAY, 0).start)).toEqual({ year: 2026, month: 9 });
        expect(referenceMonth(gridRange({ date: '2026-11-30' }, TODAY, 1).start)).toEqual({ year: 2026, month: 10 });
        expect(referenceMonth(gridRange({ date: '2026-11-30', weekOffset: 3 }, TODAY, 1).start)).toEqual({ year: 2026, month: 11 });
    });

    it('when the day rolls, a following grid moves to the new today, a fixed one stays', () => {
        expect(gridRange({}, '2026-10-31', 0).start).toBe('2026-09-27');
        expect(gridRange({}, '2026-11-01', 0).start).toBe('2026-11-01');
        expect(gridRange({ date: '2026-10-11', weekOffset: 1 }, '2026-10-31', 0).start).toBe('2026-10-04');
        expect(gridRange({ date: '2026-10-11', weekOffset: 1 }, '2026-11-01', 0).start).toBe('2026-10-04');
    });
});

describe('moving the grid', () => {
    it('Today clears the date and the offset: the view follows today again', () => {
        expect(gridFollowingToday()).toEqual({ date: undefined, weekOffset: undefined });
    });

    it('go to a day puts the day in date as it is and clears the offset', () => {
        expect(gridAt('2026-11-15')).toEqual({ date: '2026-11-15', weekOffset: undefined });
    });

    it('the arrows move only the offset; while following, today is fixed first', () => {
        expect(gridShifted({}, TODAY, 1)).toEqual({ date: TODAY, weekOffset: 1 });
        expect(gridShifted({}, TODAY, -1)).toEqual({ date: TODAY, weekOffset: -1 });
        expect(gridShifted({ date: '2026-11-15', weekOffset: 2 }, TODAY, 1)).toEqual({ date: '2026-11-15', weekOffset: 3 });
        // Back to the month grid, the offset is absent again.
        expect(gridShifted({ date: '2026-11-15', weekOffset: 1 }, TODAY, -1)).toEqual({ date: '2026-11-15', weekOffset: undefined });
    });

    it('the grid an arrow shows is the one drawn moved by a week, following or fixed', () => {
        for (const ws of [0, 1] as const) {
            for (const from of [{}, { date: '2026-11-15', weekOffset: -1 }]) {
                const before = gridRange(from, TODAY, ws).start;
                const after = gridRange(gridShifted(from, TODAY, 1), TODAY, ws).start;
                expect(after).toBe(DateUtils.addDays(before, 7));
            }
        }
    });

    it('a URI or the CLI date shows the grid Go to date shows', () => {
        for (const codec of [CalendarCodec, MiniCalendarCodec]) {
            const fromUri = codec.transientOfState({ date: '2026-11-15' });
            expect(gridRange(fromUri, TODAY, 1)).toEqual(gridRange(gridAt('2026-11-15'), TODAY, 1));
        }
    });
});

describe('the saved position', () => {
    it('is read from date and weekOffset, and the older windowStart is not read', () => {
        for (const codec of [CalendarCodec, MiniCalendarCodec]) {
            expect(codec.parseTransient({ date: '2026-10-11', weekOffset: 2 })).toMatchObject({ date: '2026-10-11', weekOffset: 2 });
            expect(codec.parseTransient({ weekOffset: '-3' })).toMatchObject({ weekOffset: -3 });
            expect(codec.parseTransient({ weekOffset: '1.5' }).weekOffset).toBeUndefined();
            expect(codec.parseTransient({ windowStart: '2026-10-11' }).date).toBeUndefined();
            expect(codec.serializeTransient({ date: '2026-10-11', weekOffset: -1 })).toMatchObject({ date: '2026-10-11', weekOffset: -1 });
            expect(codec.schema.anchorKey).toBe('date');
        }
    });

    it('is set whole by a state that names it: a date alone clears the offset', () => {
        for (const codec of [CalendarCodec, MiniCalendarCodec]) {
            expect(codec.transientOfState({ date: '2026-10-11' })).toEqual({ date: '2026-10-11', weekOffset: undefined });
            expect(codec.transientOfState({ weekOffset: 2 })).toEqual({ date: undefined, weekOffset: 2 });
            // A state that does not name it leaves it where the view has it.
            expect(codec.transientOfState({})).toEqual({});
            expect('weekOffset' in codec.transientOfState({ date: 'not-a-day' })).toBe(false);
        }
    });

    it('is where the view is, so a reset keeps it', () => {
        for (const codec of [CalendarCodec, MiniCalendarCodec]) {
            const patch = resetPatch(codec);
            expect('date' in patch).toBe(false);
            expect('weekOffset' in patch).toBe(false);
        }
    });
});
