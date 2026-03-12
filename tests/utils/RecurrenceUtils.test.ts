import { describe, it, expect } from 'vitest';
import { RecurrenceUtils } from '../../src/utils/RecurrenceUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a Date without timezone ambiguity (local midnight). */
function d(yyyy: number, mm: number, dd: number): Date {
    return new Date(yyyy, mm - 1, dd);
}

function fmt(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecurrenceUtils.calculateNextDate', () => {

    // -- Absolute date ---------------------------------------------------------

    describe('absolute date', () => {
        it('parses YYYY-MM-DD', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 1, 1), '2026-03-15');
            expect(fmt(result)).toBe('2026-03-15');
        });

        it('parses YYYY/MM/DD', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 1, 1), '2026/12/25');
            expect(fmt(result)).toBe('2026-12-25');
        });
    });

    // -- Natural language shortcuts -------------------------------------------

    describe('natural language', () => {
        it('tomorrow → +1 day', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'tomorrow');
            expect(fmt(result)).toBe('2026-03-12');
        });

        it('today → same day', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'today');
            expect(fmt(result)).toBe('2026-03-11');
        });

        it('next week → +7 days', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'next week');
            expect(fmt(result)).toBe('2026-03-18');
        });
    });

    // -- Weekday names --------------------------------------------------------

    describe('weekday names', () => {
        it('monday → next Monday', () => {
            // 2026-03-11 is a Wednesday
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'monday');
            expect(result.getDay()).toBe(1); // Monday
            expect(result > d(2026, 3, 11)).toBe(true);
        });

        it('next friday → next Friday', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'next friday');
            expect(result.getDay()).toBe(5); // Friday
            expect(result > d(2026, 3, 11)).toBe(true);
        });
    });

    // -- Simple keywords ------------------------------------------------------

    describe('simple keywords', () => {
        it('daily → +1 day', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'daily');
            expect(fmt(result)).toBe('2026-03-12');
        });

        it('every day → +1 day', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'every day');
            expect(fmt(result)).toBe('2026-03-12');
        });

        it('weekly → +7 days', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'weekly');
            expect(fmt(result)).toBe('2026-03-18');
        });

        it('monthly → +1 month', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'monthly');
            expect(fmt(result)).toBe('2026-04-11');
        });

        it('yearly → +1 year', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'yearly');
            expect(fmt(result)).toBe('2027-03-11');
        });

        it('weekdays → next weekday (skips weekend)', () => {
            // 2026-03-13 is a Friday → next weekday is Monday 03-16
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 13), 'weekdays');
            expect(fmt(result)).toBe('2026-03-16');
        });

        it('weekends → next weekend day', () => {
            // 2026-03-11 is a Wednesday → next weekend is Saturday 03-14
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'weekends');
            expect(fmt(result)).toBe('2026-03-14');
        });
    });

    // -- N units pattern ------------------------------------------------------

    describe('N units pattern', () => {
        it('3 days', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), '3 days');
            expect(fmt(result)).toBe('2026-03-14');
        });

        it('every 2 weeks', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'every 2 weeks');
            expect(fmt(result)).toBe('2026-03-25');
        });

        it('next 1 month', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'next 1 month');
            expect(fmt(result)).toBe('2026-04-11');
        });

        it('2 years', () => {
            const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), '2 years');
            expect(fmt(result)).toBe('2028-03-11');
        });
    });

    // -- Default fallback -----------------------------------------------------

    it('unknown string defaults to +1 day', () => {
        const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'gibberish');
        expect(fmt(result)).toBe('2026-03-12');
    });

    // -- Case insensitivity ---------------------------------------------------

    it('is case-insensitive', () => {
        const result = RecurrenceUtils.calculateNextDate(d(2026, 3, 11), 'DAILY');
        expect(fmt(result)).toBe('2026-03-12');
    });
});
