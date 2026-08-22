import { describe, it, expect } from 'vitest';
import { contextualDateLabel } from '../../../src/views/sharedUI/DateHeaderRenderer';

/**
 * The date header's label rule, now that it is the only one. A ResizeObserver
 * used to shorten labels by cell width as well, but both callers pass a
 * reference month, so that path had been unreachable since `4ad2762a`.
 */
const AUGUST_2026 = { year: 2026, month: 7 };   // month is 0-based

describe('contextualDateLabel', () => {
    it('shows only the day for a date inside the reference month', () => {
        // The toolbar already says 2026-08; repeating it in every cell is noise.
        expect(contextualDateLabel('2026-08-17', AUGUST_2026, '月')).toBe('17 月');
    });

    it('adds the month once the date leaves it', () => {
        expect(contextualDateLabel('2026-09-01', AUGUST_2026, '火')).toBe('09-01 火');
        expect(contextualDateLabel('2026-07-31', AUGUST_2026, '金')).toBe('07-31 金');
    });

    it('spells out the year once the date leaves it', () => {
        expect(contextualDateLabel('2027-01-05', AUGUST_2026, '火')).toBe('2027-01-05 火');
    });

    it('spells out the year even when the month happens to match', () => {
        // Same month number, different year: dropping the year would make
        // 2025-08-17 and 2026-08-17 read identically.
        expect(contextualDateLabel('2025-08-17', AUGUST_2026, '日')).toBe('2025-08-17 日');
    });

    it('keeps the day zero-padded, as the date string has it', () => {
        expect(contextualDateLabel('2026-08-03', AUGUST_2026, '月')).toBe('03 月');
    });

    it('handles the January reference month without wrapping', () => {
        const january = { year: 2026, month: 0 };
        expect(contextualDateLabel('2026-01-09', january, '金')).toBe('09 金');
        expect(contextualDateLabel('2025-12-31', january, '水')).toBe('2025-12-31 水');
    });
});
