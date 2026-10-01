import { describe, it, expect } from 'vitest';
import { normalizeTask } from '../../../src/api/TaskNormalizer';
import { toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { evaluateFilter } from '../helpers/filterContext';
import type { FilterState } from '../../../src/services/filter/FilterTypes';
import { makeTask } from '../helpers/makeTask';

/**
 * `durationMinutes` measures from the effective start to the effective end,
 * dates included, as the filter's `length` does. It used to subtract the
 * times of day alone, so a task spanning two days and an hour read as 60.
 */
const noRow = () => undefined;
const START_HOUR = 5;

function minutesOf(overrides: Parameters<typeof makeTask>[0]) {
    const dt = toDisplayTask(makeTask(overrides), START_HOUR);
    return { dt, minutes: normalizeTask(dt, noRow, START_HOUR).durationMinutes };
}

describe('durationMinutes counts the days between start and end', () => {
    it('2026-01-01T10:00 to 2026-01-03T11:00 is 49 hours', () => {
        const { minutes } = minutesOf({ startDate: '2026-01-01', startTime: '10:00', endDate: '2026-01-03', endTime: '11:00' });
        expect(minutes).toBe(49 * 60);
    });

    it('a task crossing midnight counts only the hours it spans', () => {
        const { minutes } = minutesOf({ startDate: '2026-01-01', startTime: '23:00', endDate: '2026-01-02', endTime: '01:00' });
        expect(minutes).toBe(120);
    });

    it('a same-day task is its time span', () => {
        const { minutes } = minutesOf({ startDate: '2026-01-01', startTime: '09:00', endDate: '2026-01-01', endTime: '09:45' });
        expect(minutes).toBe(45);
    });

    it('a task with only a due date has none', () => {
        const { minutes } = minutesOf({ due: '2026-01-05' });
        expect(minutes).toBeNull();
    });

    it('agrees with the filter: a task `length greaterThan 24 hours` picks up reports more than 24 hours', () => {
        const { dt, minutes } = minutesOf({ startDate: '2026-01-01', startTime: '10:00', endDate: '2026-01-03', endTime: '11:00' });
        const state: FilterState = {
            filters: [{ id: 'c', property: 'length', operator: 'greaterThan', value: 24, unit: 'hours' }],
            logic: 'and',
        } as FilterState;
        expect(evaluateFilter(dt, state, { startHour: START_HOUR })).toBe(true);
        expect(minutes).toBeGreaterThan(24 * 60);
    });
});
