import { describe, it, expect } from 'vitest';
import { evaluateFilter } from '../helpers/filterContext';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';
import type { FilterCondition } from '../../../src/services/filter/FilterTypes';

/** The filter compares moments with the visual days a value names (startHour 5). */
const matches = (task: Partial<Task>, condition: FilterCondition) =>
    evaluateFilter(makeTask(task), { filters: [condition], logic: 'and' }, { startHour: 5 });

describe('date conditions compare moments (startHour 5)', () => {
    it('@2026-10-04 starts and ends on 10/04, not on 10/05', () => {
        const task = { startDate: '2026-10-04' };
        expect(matches(task, { property: 'startDate', operator: 'equals', value: '2026-10-04' })).toBe(true);
        expect(matches(task, { property: 'endDate', operator: 'equals', value: '2026-10-04' })).toBe(true);
        expect(matches(task, { property: 'endDate', operator: 'equals', value: '2026-10-05' })).toBe(false);
    });

    it('a start before startHour is the day before', () => {
        expect(matches({ startDate: '2026-10-05', startTime: '02:00' },
            { property: 'startDate', operator: 'equals', value: '2026-10-04' })).toBe(true);
    });

    it('a due right at startHour closes the day before', () => {
        expect(matches({ due: '2026-10-05T05:00' }, { property: 'due', operator: 'equals', value: '2026-10-04' })).toBe(true);
        expect(matches({ due: '2026-10-05T05:00' }, { property: 'due', operator: 'equals', value: '2026-10-05' })).toBe(false);
    });

    it('@D>E ends on E−1 under the rule until 11c, as it is drawn', () => {
        const task = { startDate: '2026-10-01', endDate: '2026-10-04' };
        expect(matches(task, { property: 'endDate', operator: 'equals', value: '2026-10-03' })).toBe(true);
        expect(matches(task, { property: 'endDate', operator: 'equals', value: '2026-10-04' })).toBe(false);
    });

    it('before and after keep to the edges', () => {
        const task = { startDate: '2026-10-04' };
        expect(matches(task, { property: 'endDate', operator: 'before', value: '2026-10-05' })).toBe(true);
        expect(matches(task, { property: 'startDate', operator: 'after', value: '2026-10-03' })).toBe(true);
        expect(matches(task, { property: 'endDate', operator: 'onOrAfter', value: '2026-10-05' })).toBe(false);
        expect(matches(task, { property: 'startDate', operator: 'onOrBefore', value: '2026-10-03' })).toBe(false);
    });

    it('@D lasts 24 hours', () => {
        expect(matches({ startDate: '2026-10-04' },
            { property: 'length', operator: 'greaterThanOrEqual', value: 24, unit: 'hours' } as FilterCondition)).toBe(true);
        expect(matches({ startDate: '2026-10-04' },
            { property: 'length', operator: 'equals', value: 1440, unit: 'minutes' } as FilterCondition)).toBe(true);
    });
});
