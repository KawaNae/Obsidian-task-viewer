import { describe, it, expect } from 'vitest';
import { ImplicitCalendarDateResolver } from '../../src/utils/ImplicitCalendarDateResolver';

/**
 * Daily note inheritance tests.
 *
 * DailyNoteUtils.parseDateFromFilePath() depends on app.internalPlugins (Obsidian API)
 * and moment strict parsing, so it's not easily unit-testable without a full mock.
 *
 * ImplicitCalendarDateResolver.resolveDailyNoteDates() is pure logic —
 * it determines whether a task inherits the daily note date.
 */
describe('ImplicitCalendarDateResolver.resolveDailyNoteDates', () => {

    it('inherits date when task has startTime but no startDate', () => {
        const task = { startTime: '09:00' };
        const result = ImplicitCalendarDateResolver.resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBe('2026-03-11');
        expect(result.startDateInherited).toBe(true);
    });

    it('does not inherit when task already has startDate', () => {
        const task = { startDate: '2026-01-01', startTime: '09:00' };
        const result = ImplicitCalendarDateResolver.resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBeUndefined();
        expect(result.startDateInherited).toBeUndefined();
    });

    it('does not inherit when task has no startTime', () => {
        const task = {};
        const result = ImplicitCalendarDateResolver.resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBeUndefined();
        expect(result.startDateInherited).toBeUndefined();
    });

    it('does not inherit when task has startDate but no startTime', () => {
        const task = { startDate: '2026-01-01' };
        const result = ImplicitCalendarDateResolver.resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBeUndefined();
    });

    it('returns empty object for task with neither date nor time', () => {
        const task = {};
        const result = ImplicitCalendarDateResolver.resolveDailyNoteDates(task, '2026-03-11');
        expect(result).toEqual({});
    });

    it('inherits with endDate/endTime present but no startDate', () => {
        const task = { startTime: '10:00', endDate: '2026-03-11', endTime: '12:00' };
        const result = ImplicitCalendarDateResolver.resolveDailyNoteDates(task, '2026-03-11');
        expect(result.startDate).toBe('2026-03-11');
        expect(result.startDateInherited).toBe(true);
    });
});
