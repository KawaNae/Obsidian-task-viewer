import { describe, it, expect } from 'vitest';
import {
    isTvFile,
    isTvInline,
    isDpInline,
    isTpInline,
    isTvFileUnscheduled,
    hasScheduling,
    hasDates,
} from '../../../src/types';

const baseFm = { parserId: 'tv-file' as const };
const baseInline = { parserId: 'tv-inline' as const };

describe('isTvFile', () => {
    it('matches only parserId==="tv-file"', () => {
        expect(isTvFile({ parserId: 'tv-file' })).toBe(true);
        expect(isTvFile({ parserId: 'tv-inline' })).toBe(false);
        expect(isTvFile({ parserId: 'tasks-plugin' })).toBe(false);
    });
});

describe('isTvInline', () => {
    it('matches only parserId==="tv-inline"', () => {
        expect(isTvInline({ parserId: 'tv-inline' })).toBe(true);
        expect(isTvInline({ parserId: 'tv-file' })).toBe(false);
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

describe('hasDates', () => {
    it('ignores time-only fields', () => {
        expect(hasDates({ startTime: '09:00', endTime: '17:00' })).toBe(false);
    });

    it('returns true for any date field', () => {
        expect(hasDates({ startDate: '2026-01-01' })).toBe(true);
        expect(hasDates({ endDate: '2026-01-01' })).toBe(true);
        expect(hasDates({ due: '2026-01-01' })).toBe(true);
    });
});

describe('isTvFileUnscheduled', () => {
    it('is true for tv-file task with no scheduling', () => {
        expect(isTvFileUnscheduled(baseFm)).toBe(true);
    });

    it('is false when tv-file task has any scheduling field', () => {
        expect(isTvFileUnscheduled({ ...baseFm, startDate: '2026-01-01' })).toBe(false);
        expect(isTvFileUnscheduled({ ...baseFm, startTime: '09:00' })).toBe(false);
        expect(isTvFileUnscheduled({ ...baseFm, due: '2026-01-01' })).toBe(false);
    });

    it('is false for non-tv-file tasks regardless of scheduling', () => {
        expect(isTvFileUnscheduled(baseInline)).toBe(false);
        expect(isTvFileUnscheduled({ parserId: 'tasks-plugin' })).toBe(false);
    });
});
