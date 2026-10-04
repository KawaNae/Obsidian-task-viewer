import { describe, it, expect } from 'vitest';
import {
    dayStart, daysWindow, instantAt, instantText, minutesInDay, minutesOfSpan, ofValue, visualDayOf, visualDaysOf,
} from '../../../src/utils/DayWindow';

const at = (text: string): number => {
    const [date, time] = text.split(' ');
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    return new Date(y, m - 1, d, h, min).getTime();
};
const span = (start: string, end: string) => ({ startMs: at(start), endMs: at(end) });

describe('DayWindow', () => {
    it('a visual day starts at startHour', () => {
        expect(dayStart('2026-10-04', 5)).toBe(at('2026-10-04 05:00'));
        expect(daysWindow('2026-10-04', '2026-10-05', 5)).toEqual(span('2026-10-04 05:00', '2026-10-06 05:00'));
    });

    it('instantAt steps across days on the wall clock', () => {
        expect(instantAt('2026-10-04', 25 * 60)).toBe(at('2026-10-05 01:00'));
        expect(instantAt('2026-10-04', -60)).toBe(at('2026-10-03 23:00'));
    });

    it('a moment before startHour is the day before', () => {
        expect(visualDayOf(at('2026-10-05 02:00'), 5)).toBe('2026-10-04');
        expect(visualDayOf(at('2026-10-05 05:00'), 5)).toBe('2026-10-05');
    });

    it('a span is drawn over the days up to the moment before its end', () => {
        expect(visualDaysOf(span('2026-10-04 05:00', '2026-10-05 05:00'), 5))
            .toEqual({ first: '2026-10-04', last: '2026-10-04' });
        expect(visualDaysOf(span('2026-10-01 22:00', '2026-10-02 05:00'), 5))
            .toEqual({ first: '2026-10-01', last: '2026-10-01' });
        expect(visualDaysOf(span('2026-10-01 22:00', '2026-10-02 06:00'), 5))
            .toEqual({ first: '2026-10-01', last: '2026-10-02' });
    });

    it('a point is drawn on the day it is in', () => {
        expect(visualDaysOf(span('2026-10-05 05:00', '2026-10-05 05:00'), 5))
            .toEqual({ first: '2026-10-05', last: '2026-10-05' });
    });

    it('minutes are counted from the start of the visual day', () => {
        expect(minutesInDay(at('2026-10-05 02:00'), '2026-10-04', 5)).toBe(1260);
        expect(minutesInDay(at('2026-10-04 05:00'), '2026-10-04', 5)).toBe(0);
        expect(minutesOfSpan(span('2026-10-04 22:00', '2026-10-05 05:00'), 5)).toEqual({ start: 1020, end: 1440 });
    });

    it('instantText reads the calendar date and time', () => {
        expect(instantText(at('2026-10-05 05:00'))).toEqual({ date: '2026-10-05', time: '05:00' });
    });

    it('a date value is its visual day; a preset counts from the visual day at now', () => {
        const ctx = { weekStartDay: 1 as const, startHour: 5, now: new Date(2026, 9, 5, 2, 0) };
        expect(ofValue('2026-10-04', ctx)).toEqual(daysWindow('2026-10-04', '2026-10-04', 5));
        expect(ofValue({ preset: 'today' }, ctx)).toEqual(daysWindow('2026-10-04', '2026-10-04', 5));
        expect(ofValue({ preset: 'thisWeek' }, ctx)).toEqual(daysWindow('2026-09-28', '2026-10-04', 5));
        expect(ofValue({ preset: 'nextNDays', n: 3 }, ctx)).toEqual(daysWindow('2026-10-04', '2026-10-06', 5));
        expect(ofValue({ preset: 'thisMonth' }, ctx)).toEqual(daysWindow('2026-10-01', '2026-10-31', 5));
    });
});
