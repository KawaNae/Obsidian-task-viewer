import { describe, it, expect } from 'vitest';
import {
    isTvInline,
    isDpInline,
    isTpInline,
    hasScheduling,
} from '../../../src/types';


describe('isTvInline', () => {
    it('matches only parserId==="tv-inline"', () => {
        expect(isTvInline({ parserId: 'tv-inline' })).toBe(true);
        expect(isTvInline({ parserId: 'tasks-plugin' })).toBe(false);
        expect(isTvInline({ parserId: 'day-planner' })).toBe(false);
    });
});

describe('isDpInline', () => {
    it('matches only parserId==="day-planner"', () => {
        expect(isDpInline({ parserId: 'day-planner' })).toBe(true);
        expect(isDpInline({ parserId: 'tv-inline' })).toBe(false);
    });
});

describe('isTpInline', () => {
    it('matches only parserId==="tasks-plugin"', () => {
        expect(isTpInline({ parserId: 'tasks-plugin' })).toBe(true);
        expect(isTpInline({ parserId: 'tv-inline' })).toBe(false);
    });
});

describe('hasScheduling', () => {
    it('returns false when no date/time fields are set', () => {
        expect(hasScheduling({})).toBe(false);
    });

    it('returns true for any single date/time field', () => {
        expect(hasScheduling({ startDate: '2026-01-01' })).toBe(true);
        expect(hasScheduling({ startTime: '09:00' })).toBe(true);
        expect(hasScheduling({ endDate: '2026-01-01' })).toBe(true);
        expect(hasScheduling({ endTime: '17:00' })).toBe(true);
        expect(hasScheduling({ due: '2026-01-01' })).toBe(true);
    });
});

