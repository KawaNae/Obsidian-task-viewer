import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateResolver } from '../../src/services/filter/DateResolver';

describe('DateResolver', () => {
    beforeEach(() => {
        // Fix time: Wednesday 2026-03-11 14:00
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 2, 11, 14, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('absolute mode', () => {
        it('returns the date as-is', () => {
            const result = DateResolver.resolve({ mode: 'absolute', date: '2026-06-15' });
            expect(result).toEqual({ start: '2026-06-15', end: '2026-06-15' });
        });
    });

    describe('today', () => {
        it('returns current date', () => {
            const result = DateResolver.resolve({ mode: 'relative', preset: 'today' });
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-11' });
        });

        it('shifts to previous day when before startHour', () => {
            // Set time to 03:00 with startHour=5 → visual "today" is 2026-03-10
            vi.setSystemTime(new Date(2026, 2, 11, 3, 0, 0));
            const result = DateResolver.resolve({ mode: 'relative', preset: 'today' }, 1, 5);
            expect(result).toEqual({ start: '2026-03-10', end: '2026-03-10' });
        });

        it('does not shift when at or after startHour', () => {
            vi.setSystemTime(new Date(2026, 2, 11, 5, 0, 0));
            const result = DateResolver.resolve({ mode: 'relative', preset: 'today' }, 1, 5);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-11' });
        });
    });

    describe('thisWeek (Monday start)', () => {
        it('returns Monday to Sunday', () => {
            // 2026-03-11 is Wednesday → week: Mon 2026-03-09 to Sun 2026-03-15
            const result = DateResolver.resolve({ mode: 'relative', preset: 'thisWeek' }, 1);
            expect(result).toEqual({ start: '2026-03-09', end: '2026-03-15' });
        });
    });

    describe('thisWeek (Sunday start)', () => {
        it('returns Sunday to Saturday', () => {
            // 2026-03-11 is Wednesday → week: Sun 2026-03-08 to Sat 2026-03-14
            const result = DateResolver.resolve({ mode: 'relative', preset: 'thisWeek' }, 0);
            expect(result).toEqual({ start: '2026-03-08', end: '2026-03-14' });
        });
    });

    describe('nextWeek', () => {
        it('returns next week bounds (Monday start)', () => {
            // Next Wednesday = 2026-03-18 → week: Mon 2026-03-16 to Sun 2026-03-22
            const result = DateResolver.resolve({ mode: 'relative', preset: 'nextWeek' }, 1);
            expect(result).toEqual({ start: '2026-03-16', end: '2026-03-22' });
        });
    });

    describe('pastWeek', () => {
        it('returns past week bounds (Monday start)', () => {
            // Past Wednesday = 2026-03-04 → week: Mon 2026-03-02 to Sun 2026-03-08
            const result = DateResolver.resolve({ mode: 'relative', preset: 'pastWeek' }, 1);
            expect(result).toEqual({ start: '2026-03-02', end: '2026-03-08' });
        });
    });

    describe('nextNDays', () => {
        it('returns today + n-1 days', () => {
            const result = DateResolver.resolve({ mode: 'relative', preset: 'nextNDays', n: 7 }, 1);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-17' });
        });

        it('defaults to 7 when n is not set', () => {
            const result = DateResolver.resolve({ mode: 'relative', preset: 'nextNDays' }, 1);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-17' });
        });

        it('n=1 means today only', () => {
            const result = DateResolver.resolve({ mode: 'relative', preset: 'nextNDays', n: 1 }, 1);
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-11' });
        });
    });

    describe('thisMonth', () => {
        it('returns month boundaries', () => {
            const result = DateResolver.resolve({ mode: 'relative', preset: 'thisMonth' });
            expect(result).toEqual({ start: '2026-03-01', end: '2026-03-31' });
        });
    });

    describe('thisYear', () => {
        it('returns year boundaries', () => {
            const result = DateResolver.resolve({ mode: 'relative', preset: 'thisYear' });
            expect(result).toEqual({ start: '2026-01-01', end: '2026-12-31' });
        });
    });

    describe('unknown preset', () => {
        it('falls back to today', () => {
            const result = DateResolver.resolve({ mode: 'relative', preset: 'unknown' as any });
            expect(result).toEqual({ start: '2026-03-11', end: '2026-03-11' });
        });
    });
});
