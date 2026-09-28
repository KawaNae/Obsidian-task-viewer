import { describe, it, expect } from 'vitest';
import { monthGridDates } from '../../../src/views/sharedUI/DatePickerPopover';

describe('monthGridDates', () => {
    it('lays out six weeks from the week of the 1st', () => {
        const dates = monthGridDates(2026, 8, 0); // September 2026, Sunday start
        expect(dates).toHaveLength(42);
        expect(dates[0]).toBe('2026-08-30');
        expect(dates[41]).toBe('2026-10-10');
    });

    it('holds every day of the month', () => {
        const dates = monthGridDates(2026, 4, 1); // May 2026 (31 days), Monday start
        for (let d = 1; d <= 31; d++) {
            expect(dates).toContain(`2026-05-${String(d).padStart(2, '0')}`);
        }
    });

    it('stays on consecutive days across a month end', () => {
        const dates = monthGridDates(2027, 1, 1); // February 2027
        expect(dates[0]).toBe('2027-02-01'); // a Monday
        expect(dates.slice(27, 30)).toEqual(['2027-02-28', '2027-03-01', '2027-03-02']);
    });
});
