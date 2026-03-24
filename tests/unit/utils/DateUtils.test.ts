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

    describe('toVisualDate', () => {
        it('returns date when no time', () => {
            expect(DateUtils.toVisualDate('2026-03-11', undefined, 5)).toBe('2026-03-11');
        });

        it('returns date when time >= startHour', () => {
            expect(DateUtils.toVisualDate('2026-03-11', '09:00', 5)).toBe('2026-03-11');
        });

        it('returns previous day when time < startHour', () => {
            expect(DateUtils.toVisualDate('2026-03-11', '03:00', 5)).toBe('2026-03-10');
        });
    });

    describe('getTaskDurationMs', () => {
        it('same day with start and end time → exact diff', () => {
            const ms = DateUtils.getTaskDurationMs('2026-03-10', '09:00', '2026-03-10', '11:00', 0);
            expect(ms).toBe(2 * 60 * 60 * 1000);
        });

        it('timed task without end → default 60 min', () => {
            const ms = DateUtils.getTaskDurationMs('2026-03-10', '09:00', undefined, undefined, 0);
            expect(ms).toBe(60 * 60 * 1000);
        });

        it('all-day task without time → ~24h', () => {
            const ms = DateUtils.getTaskDurationMs('2026-03-10', undefined, undefined, undefined, 0);
            // endDate at next day 23:59 (startHour=0 → endHour=23)
            expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
        });
    });

    describe('formatDateTimeForStorage', () => {
        it('date + time → combined', () => {
            expect(DateUtils.formatDateTimeForStorage('2026-03-11', '09:00')).toBe('2026-03-11T09:00');
        });

        it('date only → date', () => {
            expect(DateUtils.formatDateTimeForStorage('2026-03-11')).toBe('2026-03-11');
        });

        it('no date, no time → null', () => {
            expect(DateUtils.formatDateTimeForStorage()).toBeNull();
        });

        it('uses fallbackDate when date missing', () => {
            expect(DateUtils.formatDateTimeForStorage(undefined, '09:00', '2026-03-11')).toBe('2026-03-11T09:00');
        });
    });

    describe('getISOWeekNumber', () => {
        it('returns correct week number', () => {
            // 2026-01-01 is Thursday → week 1
            expect(DateUtils.getISOWeekNumber(new Date(2026, 0, 1))).toBe(1);
        });
    });
});
