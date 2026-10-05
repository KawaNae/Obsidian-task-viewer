import { describe, it, expect, beforeEach } from 'vitest';
import { daysOfValue, daysWindow, endDayOf, instantAt, ofValue, visualDayOf } from '../../../src/utils/DayWindow';
import type { DateFilterValue } from '../../../src/services/filter/FilterTypes';

/** The visual days, first and last, of the window `ofValue` names. */
function resolve(value: DateFilterValue, weekStartDay: 0 | 1, startHour: number, now: Date) {
    const window = ofValue(value, { weekStartDay, startHour, now });
    return { start: visualDayOf(window.startMs, startHour), end: endDayOf(window.endMs, startHour) };
}

describe('ofValue: the days a date value and a preset name', () => {
    // The clock is an argument: Wednesday 2026-03-11 14:00 unless a test moves it.
    let now: Date;
    beforeEach(() => {
        now = new Date(2026, 2, 11, 14, 0, 0);
    });

    describe('absolute mode', () => {
        it('returns the date as-is', () => {
            const result = resolve('2026-06-15', 1, 0, now);
            expect(result).toEqual({ start: '2026-06-15', end: '2026-06-15' });
        });
    });

    describe('today', () => {
        it('returns current date', () => {
            const result = resolve({ preset: 'today' }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-11' });
        });

        it('shifts to previous day when before startHour', () => {
            // Set time to 03:00 with startHour=5 → visual "today" is 2026-03-10
            now = new Date(2026, 2, 11, 3, 0, 0);
            const result = resolve({ preset: 'today' }, 1, 5, now);
            expect(result).toEqual({ start: '2026-03-10', end: '2026-03-10' });
        });

        it('does not shift when at or after startHour', () => {
            now = new Date(2026, 2, 11, 5, 0, 0);
            const result = resolve({ preset: 'today' }, 1, 5, now);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-11' });
        });
    });

    describe('thisWeek (Monday start)', () => {
        it('returns Monday to Sunday', () => {
            // 2026-03-11 is Wednesday → week: Mon 2026-03-09 to Sun 2026-03-15
            const result = resolve({ preset: 'thisWeek' }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-09', end: '2026-03-15' });
        });
    });

    describe('thisWeek (Sunday start)', () => {
        it('returns Sunday to Saturday', () => {
            // 2026-03-11 is Wednesday → week: Sun 2026-03-08 to Sat 2026-03-14
            const result = resolve({ preset: 'thisWeek' }, 0, 0, now);
            expect(result).toEqual({ start: '2026-03-08', end: '2026-03-14' });
        });
    });

    describe('nextWeek', () => {
        it('returns next week bounds (Monday start)', () => {
            // Next Wednesday = 2026-03-18 → week: Mon 2026-03-16 to Sun 2026-03-22
            const result = resolve({ preset: 'nextWeek' }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-16', end: '2026-03-22' });
        });
    });

    describe('pastWeek', () => {
        it('returns past week bounds (Monday start)', () => {
            // Past Wednesday = 2026-03-04 → week: Mon 2026-03-02 to Sun 2026-03-08
            const result = resolve({ preset: 'pastWeek' }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-02', end: '2026-03-08' });
        });
    });

    describe('nextNDays', () => {
        it('returns today + n-1 days', () => {
            const result = resolve({ preset: 'nextNDays', n: 7 }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-17' });
        });

        it('defaults to 7 when n is not set', () => {
            const result = resolve({ preset: 'nextNDays' }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-17' });
        });

        it('n=1 means today only', () => {
            const result = resolve({ preset: 'nextNDays', n: 1 }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-11' });
        });
    });

    describe('thisMonth', () => {
        it('returns month boundaries', () => {
            const result = resolve({ preset: 'thisMonth' }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-01', end: '2026-03-31' });
        });
    });

    describe('thisYear', () => {
        it('returns year boundaries', () => {
            const result = resolve({ preset: 'thisYear' }, 1, 0, now);
            expect(result).toEqual({ start: '2026-01-01', end: '2026-12-31' });
        });
    });

    describe('unknown preset', () => {
        it('falls back to today', () => {
            const result = resolve({ preset: 'unknown' as any }, 1, 0, now);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-11' });
        });
    });
});

describe('ofValue: a date and a time, and a range (startHour 5, now 2026-10-04 12:00)', () => {
    const ctx = { weekStartDay: 1 as const, startHour: 5, now: new Date(2026, 9, 4, 12, 0) };
    const at = (date: string, hh: number, mm = 0) => instantAt(date, hh * 60 + mm);

    it('a date and a time is the moment, a point', () => {
        expect(ofValue('2026-10-04T10:00', ctx)).toEqual({ startMs: at('2026-10-04', 10), endMs: at('2026-10-04', 10) });
    });

    it('a range of dates runs from the start of its first day to the end of its last', () => {
        expect(ofValue({ from: '2026-10-01', to: '2026-10-03' }, ctx))
            .toEqual({ startMs: at('2026-10-01', 5), endMs: at('2026-10-04', 5) });
    });

    it('a range with one end is open on the other side; an end of \'\' is none', () => {
        expect(ofValue({ from: '2026-10-01' }, ctx)).toEqual({ startMs: at('2026-10-01', 5), endMs: Infinity });
        expect(ofValue({ from: '', to: '2026-10-03' }, ctx)).toEqual({ startMs: -Infinity, endMs: at('2026-10-04', 5) });
    });

    it('an end may be a preset: this week to next week is two weeks', () => {
        expect(ofValue({ from: { preset: 'thisWeek' }, to: { preset: 'nextWeek' } }, ctx))
            .toEqual(daysWindow('2026-09-28', '2026-10-11', 5));
    });

    it('an end may be a date and a time', () => {
        expect(ofValue({ from: '2026-10-01T10:00', to: '2026-10-03T18:30' }, ctx))
            .toEqual({ startMs: at('2026-10-01', 10), endMs: at('2026-10-03', 18, 30) });
    });

    it('daysOfValue: a preset is its days, a range its ends, a moment its visual day', () => {
        expect(daysOfValue({ preset: 'thisWeek' }, ctx)).toEqual({ from: '2026-09-28', to: '2026-10-04' });
        expect(daysOfValue({ from: { preset: 'thisWeek' } }, ctx)).toEqual({ from: '2026-09-28' });
        expect(daysOfValue('2026-10-05T02:00', ctx)).toEqual({ from: '2026-10-04', to: '2026-10-04' });
    });
});
