import { describe, it, expect } from 'vitest';
import { shiftTaskDates } from '../../../src/utils/ShiftDates';

describe('shiftTaskDates', () => {
    const task = { startDate: '2026-03-11', startTime: '09:00', endDate: '2026-03-12', endTime: '10:00', due: '2026-03-20T18:00' };

    it('moves the dates of the fields asked for, each time kept', () => {
        expect(shiftTaskDates(task, 1, ['start', 'end', 'due'])).toEqual({
            startDate: '2026-03-12', startTime: '09:00', endDate: '2026-03-13', endTime: '10:00', due: '2026-03-21T18:00',
        });
    });

    it('leaves the fields not asked for as they were', () => {
        expect(shiftTaskDates(task, -1, ['start'])).toEqual({ ...task, startDate: '2026-03-10' });
    });

    it('writes no date the task did not write', () => {
        expect(shiftTaskDates({ startTime: '09:00' } as { startTime: string; startDate?: string }, 1, ['start', 'end', 'due']))
            .toEqual({ startTime: '09:00' });
    });

    it('returns a new object', () => {
        const shifted = shiftTaskDates(task, 1, ['start']);
        expect(shifted).not.toBe(task);
        expect(task.startDate).toBe('2026-03-11');
    });
});
