import { describe, it, expect } from 'vitest';
import { resolveDailyNoteDates } from '../../../src/services/parsing/resolveDailyNoteDates';

/**
 * Daily note inheritance tests.
 *
 * DailyNoteUtils.parseDateFromFilePath() depends on app.internalPlugins (Obsidian API)
 * and moment strict parsing, so it's not easily unit-testable without a full mock.
 *
 * resolveDailyNoteDates() is pure logic —
 * it determines whether a task inherits the daily note date.
 */
describe('resolveDailyNoteDates', () => {

    it('inherits date when task has startTime but no startDate', () => {
        const task = { startTime: '09:00' };
        const result = resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBe('2026-03-11');
        expect(result.startDateInherited).toBe(true);
    });

    it('does not inherit when task already has startDate', () => {
        const task = { startDate: '2026-01-01', startTime: '09:00' };
        const result = resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBeUndefined();
        expect(result.startDateInherited).toBeUndefined();
    });

    it('inherits for bare checkbox (no scheduling fields at all)', () => {
        // After parser unification, a bare `- [ ]` is a tv-inline task with
        // no scheduling fields; in a daily note it inherits the note's date.
        const task = {};
        const result = resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBe('2026-03-11');
        expect(result.startDateInherited).toBe(true);
    });

    it('does not inherit when task has startDate but no startTime', () => {
        const task = { startDate: '2026-01-01' };
        const result = resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBeUndefined();
    });

    it('does not inherit when task has endDate but no startDate or startTime', () => {
        // endDate as the only anchor — the task already points at a specific
        // date, so don't override with the daily note date.
        const task = { endDate: '2026-04-01' };
        const result = resolveDailyNoteDates(task, '2026-03-11');
        expect(result).toEqual({});
    });

    it('inherits with endDate/endTime present but no startDate', () => {
        const task = { startTime: '10:00', endDate: '2026-03-11', endTime: '12:00' };
        const result = resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBe('2026-03-11');
        expect(result.startDateInherited).toBe(true);
    });
});
