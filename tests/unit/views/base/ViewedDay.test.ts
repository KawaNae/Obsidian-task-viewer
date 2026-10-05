import { describe, it, expect } from 'vitest';
import { followToday, followsToday, shiftedDay, viewedDay } from '../../../../src/views/base/ViewedDay';

describe('the day a dated view looks at', () => {
    it('is today while the view follows it, and the fixed date otherwise', () => {
        expect(viewedDay(undefined, '2026-10-03')).toBe('2026-10-03');
        expect(viewedDay('2026-09-01', '2026-10-03')).toBe('2026-09-01');
        expect(followsToday(undefined)).toBe(true);
        expect(followsToday('2026-09-01')).toBe(false);
    });

    it('a step moves from the day looked at and fixes the day', () => {
        expect(shiftedDay(undefined, '2026-10-03', 1)).toEqual({ date: '2026-10-04' });
        expect(shiftedDay('2026-03-01', '2026-10-03', -1)).toEqual({ date: '2026-02-28' });
    });

    it('Today clears the date, so the view follows today again', () => {
        expect(followToday()).toEqual({ date: undefined });
        expect('date' in followToday()).toBe(true);
    });

    it('after the day rolls a following view looks at the new day, a fixed one stays', () => {
        expect(viewedDay(undefined, '2026-10-04')).toBe('2026-10-04');
        expect(viewedDay('2026-10-03', '2026-10-04')).toBe('2026-10-03');
    });
});
