import { describe, it, expect } from 'vitest';
import {
    isFrontmatterTask,
    isFrontmatterContainer,
    hasScheduling,
    hasDates,
} from '../../../src/types';

const baseFm = { parserId: 'tv-file' as const };
const baseInline = { parserId: 'tv-inline' as const };

describe('isFrontmatterTask', () => {
    it('matches only parserId==="tv-file"', () => {
        expect(isFrontmatterTask({ parserId: 'tv-file' })).toBe(true);
        expect(isFrontmatterTask({ parserId: 'tv-inline' })).toBe(false);
        expect(isFrontmatterTask({ parserId: 'tasks-plugin' })).toBe(false);
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

describe('isFrontmatterContainer', () => {
    it('is true for FM task with no scheduling', () => {
        expect(isFrontmatterContainer(baseFm)).toBe(true);
    });

    it('is false when FM task has any scheduling field', () => {
        expect(isFrontmatterContainer({ ...baseFm, startDate: '2026-01-01' })).toBe(false);
        expect(isFrontmatterContainer({ ...baseFm, startTime: '09:00' })).toBe(false);
        expect(isFrontmatterContainer({ ...baseFm, due: '2026-01-01' })).toBe(false);
    });

    it('is false for non-frontmatter tasks regardless of scheduling', () => {
        expect(isFrontmatterContainer(baseInline)).toBe(false);
        expect(isFrontmatterContainer({ parserId: 'tasks-plugin' })).toBe(false);
    });
});
