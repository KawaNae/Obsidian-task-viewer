import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateUtils } from '../../../src/utils/DateUtils';

describe('DateUtils', () => {
    describe('getLocalDateString', () => {
        it('formats date as YYYY-MM-DD', () => {
            expect(DateUtils.getLocalDateString(new Date(2026, 2, 11))).toBe('2026-03-11');
        });

        it('pads month and day', () => {
            expect(DateUtils.getLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
        });
    });

    describe('formatHHMM', () => {
        it('pads both hours and minutes', () => {
            expect(DateUtils.formatHHMM(9, 5)).toBe('09:05');
        });

        it('leaves already-two-digit values unpadded', () => {
            expect(DateUtils.formatHHMM(14, 30)).toBe('14:30');
        });

        it('handles midnight', () => {
            expect(DateUtils.formatHHMM(0, 0)).toBe('00:00');
        });
    });

    describe('getDiffDays', () => {
        it('same day → 0', () => {
            expect(DateUtils.getDiffDays('2026-03-11', '2026-03-11')).toBe(0);
        });

        it('positive diff', () => {
            expect(DateUtils.getDiffDays('2026-03-10', '2026-03-15')).toBe(5);
        });

        it('negative diff', () => {
            expect(DateUtils.getDiffDays('2026-03-15', '2026-03-10')).toBe(-5);
        });

        it('across month boundary', () => {
            expect(DateUtils.getDiffDays('2026-02-28', '2026-03-01')).toBe(1);
        });
    });

    describe('addDays', () => {
        it('adds positive days', () => {
            expect(DateUtils.addDays('2026-03-10', 5)).toBe('2026-03-15');
        });

        it('subtracts days', () => {
            expect(DateUtils.addDays('2026-03-10', -5)).toBe('2026-03-05');
        });

        it('crosses month boundary', () => {
            expect(DateUtils.addDays('2026-03-30', 3)).toBe('2026-04-02');
        });

        it('crosses year boundary', () => {
            expect(DateUtils.addDays('2026-12-30', 5)).toBe('2027-01-04');
        });
    });

    describe('shiftDateString', () => {
        it('shifts date-only string', () => {
            expect(DateUtils.shiftDateString('2026-03-10', 1)).toBe('2026-03-11');
        });

        it('shifts datetime string, preserves time', () => {
            expect(DateUtils.shiftDateString('2026-03-10T09:30', 2)).toBe('2026-03-12T09:30');
        });
    });

    describe('isValidDateString', () => {
        it('valid date', () => {
            expect(DateUtils.isValidDateString('2026-03-11')).toBe(true);
        });

        it('invalid format', () => {
            expect(DateUtils.isValidDateString('2026/03/11')).toBe(false);
        });

        it('invalid date', () => {
            expect(DateUtils.isValidDateString('2026-13-01')).toBe(false);
        });

        it('rejects day-of-month overflow', () => {
            expect(DateUtils.isValidDateString('2026-02-30')).toBe(false);
            expect(DateUtils.isValidDateString('2026-04-31')).toBe(false);
        });

        it('rejects Feb 29 on a non-leap year but allows it on a leap year', () => {
            expect(DateUtils.isValidDateString('2025-02-29')).toBe(false);
            expect(DateUtils.isValidDateString('2024-02-29')).toBe(true);
        });
    });

    describe('isValidTimeString', () => {
        it('valid time', () => {
            expect(DateUtils.isValidTimeString('09:30')).toBe(true);
        });

        it('midnight', () => {
            expect(DateUtils.isValidTimeString('00:00')).toBe(true);
        });

        it('invalid hour', () => {
            expect(DateUtils.isValidTimeString('25:00')).toBe(false);
        });

        it('invalid format', () => {
            expect(DateUtils.isValidTimeString('9:30')).toBe(false);
        });
    });

    describe('timeToMinutes / minutesToTime', () => {
        it('converts time to minutes', () => {
            expect(DateUtils.timeToMinutes('09:30')).toBe(570);
        });

        it('converts minutes to time', () => {
            expect(DateUtils.minutesToTime(570)).toBe('09:30');
        });

        it('handles midnight', () => {
            expect(DateUtils.minutesToTime(0)).toBe('00:00');
        });

        it('wraps beyond 24h', () => {
            expect(DateUtils.minutesToTime(24 * 60 + 30)).toBe('00:30');
        });
    });

    describe('getVisualDateOfNow', () => {
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => { vi.useRealTimers(); });

        it('returns today when after startHour', () => {
            vi.setSystemTime(new Date(2026, 2, 11, 14, 0));
            expect(DateUtils.getVisualDateOfNow(5)).toBe('2026-03-11');
        });

        it('returns previous day when before startHour', () => {
            vi.setSystemTime(new Date(2026, 2, 11, 3, 0));
            expect(DateUtils.getVisualDateOfNow(5)).toBe('2026-03-10');
        });
    });

    describe('getVisualWeekKey', () => {
        // 2026-05-13 is Wednesday. Week containing it:
        // - weekStartDay=1 (Monday): starts 2026-05-11
        // - weekStartDay=0 (Sunday): starts 2026-05-10
        it('Wednesday + weekStartDay=1 → previous Monday', () => {
            expect(DateUtils.getVisualWeekKey(new Date(2026, 4, 13), 1)).toBe('2026-05-11');
        });

        it('Wednesday + weekStartDay=0 → previous Sunday', () => {
            expect(DateUtils.getVisualWeekKey(new Date(2026, 4, 13), 0)).toBe('2026-05-10');
        });

        it('Monday + weekStartDay=1 → same day', () => {
            expect(DateUtils.getVisualWeekKey(new Date(2026, 4, 11), 1)).toBe('2026-05-11');
        });

        it('Sunday + weekStartDay=0 → same day', () => {
            expect(DateUtils.getVisualWeekKey(new Date(2026, 4, 10), 0)).toBe('2026-05-10');
        });

        it('Sunday + weekStartDay=1 → previous Monday (not same day)', () => {
            // Sunday 2026-05-10 with Monday-start: belongs to week starting 2026-05-04
            expect(DateUtils.getVisualWeekKey(new Date(2026, 4, 10), 1)).toBe('2026-05-04');
        });

        it('two dates in same visual week return same key', () => {
            const tue = DateUtils.getVisualWeekKey(new Date(2026, 4, 12), 1);
            const fri = DateUtils.getVisualWeekKey(new Date(2026, 4, 15), 1);
            expect(tue).toBe(fri);
        });
    });

    describe('getMonthGridStart', () => {
        // 2026-09-01 is a Tuesday.
        it('backs up from the 1st to the Sunday when weeks start on Sunday', () => {
            expect(DateUtils.getMonthGridStart(new Date(2026, 8, 17), 0)).toBe('2026-08-30');
        });

        it('backs up from the 1st to the Monday when weeks start on Monday', () => {
            expect(DateUtils.getMonthGridStart(new Date(2026, 8, 17), 1)).toBe('2026-08-31');
        });

        it('starts on the 1st itself when it is the week start', () => {
            // 2026-11-01 is a Sunday.
            expect(DateUtils.getMonthGridStart(new Date(2026, 10, 30), 0)).toBe('2026-11-01');
        });

        it('crosses a year boundary', () => {
            // 2027-01-01 is a Friday.
            expect(DateUtils.getMonthGridStart(new Date(2027, 0, 20), 1)).toBe('2026-12-28');
        });
    });

    describe('dateAt / parseDate / readDate', () => {
        it('keeps a two-digit year as written', () => {
            expect(DateUtils.dateAt(26, 0, 1).getFullYear()).toBe(26);
            expect(DateUtils.parseDate('0026-01-01').getFullYear()).toBe(26);
        });

        it('parses as local midnight', () => {
            const d = DateUtils.parseDate('2026-03-14');
            expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 14, 0]);
        });

        it('readDate rejects a wrong shape and a day that does not exist', () => {
            expect(DateUtils.readDate('2026-3-14')).toBeNull();
            expect(DateUtils.readDate('2026-02-30')).toBeNull();
            expect(DateUtils.readDate('2026-03-14T10:00')).toBeNull();
            expect(DateUtils.readDate('2024-02-29')?.getDate()).toBe(29);
        });
    });

    describe('getLocalDateString', () => {
        it('prints the year with four digits', () => {
            expect(DateUtils.getLocalDateString(DateUtils.dateAt(26, 0, 1))).toBe('0026-01-01');
            expect(DateUtils.getLocalDateString(DateUtils.dateAt(999, 11, 31))).toBe('0999-12-31');
        });
    });

    describe('isDateShape / isValidDateString', () => {
        it('shape only vs a day that exists', () => {
            expect(DateUtils.isDateShape('2026-02-30')).toBe(true);
            expect(DateUtils.isValidDateString('2026-02-30')).toBe(false);
        });

        it('accepts a year below 100, which the notation and the lexer read as written', () => {
            expect(DateUtils.isValidDateString('0026-01-01')).toBe(true);
        });
    });

    describe('toDateTime / weekdayOf', () => {
        it('builds a local moment', () => {
            const d = DateUtils.toDateTime('2026-03-14', '09:05');
            expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 2, 14, 9, 5]);
        });

        it('weekday of a date string', () => {
            expect(DateUtils.weekdayOf('2026-03-15')).toBe(0); // Sunday
            expect(DateUtils.weekdayOf('2026-03-16')).toBe(1);
        });
    });

    describe('splitDateTime / joinDateTime', () => {
        it('splits a date and a date-time', () => {
            expect(DateUtils.splitDateTime('2026-03-14')).toEqual({ date: '2026-03-14' });
            expect(DateUtils.splitDateTime('2026-03-14T10:00')).toEqual({ date: '2026-03-14', time: '10:00' });
        });

        it('joins, dropping a time without a date', () => {
            expect(DateUtils.joinDateTime('2026-03-14', '10:00')).toBe('2026-03-14T10:00');
            expect(DateUtils.joinDateTime('2026-03-14', '')).toBe('2026-03-14');
            expect(DateUtils.joinDateTime('', '10:00')).toBeUndefined();
            expect(DateUtils.joinDateTime(undefined, undefined)).toBeUndefined();
        });

        it('round-trips', () => {
            for (const v of ['2026-03-14', '2026-03-14T23:59']) {
                const { date, time } = DateUtils.splitDateTime(v);
                expect(DateUtils.joinDateTime(date, time)).toBe(v);
            }
        });
    });

    describe('visualDateAt', () => {
        it('takes the clock as an argument', () => {
            expect(DateUtils.visualDateAt(new Date(2026, 0, 1, 4, 59), 5)).toBe('2025-12-31');
            expect(DateUtils.visualDateAt(new Date(2026, 0, 1, 5, 0), 5)).toBe('2026-01-01');
            expect(DateUtils.visualDateAt(new Date(2026, 0, 1, 0, 0), 0)).toBe('2026-01-01');
        });
    });

});
