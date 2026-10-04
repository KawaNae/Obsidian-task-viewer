import { describe, it, expect } from 'vitest';
import { normalizeTask } from '../../../src/api/TaskNormalizer';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/** The API's effective* are the span's moments on the calendar and the clock (startHour 5). */
const out = (task: Partial<Task>) =>
    normalizeTask(toDisplayTask(makeTask(task), 5, NO_TASK_LOOKUP), NO_TASK_LOOKUP, 5);

describe('normalizeTask: the span', () => {
    it('@2026-10-04 runs from 05:00 to 05:00 the next day, 1440 minutes', () => {
        const t = out({ startDate: '2026-10-04' });
        expect([t.effectiveStartDate, t.effectiveStartTime, t.effectiveEndDate, t.effectiveEndTime])
            .toEqual(['2026-10-04', '05:00', '2026-10-05', '05:00']);
        expect(t.durationMinutes).toBe(1440);
    });

    it('a written end time is given as written', () => {
        const t = out({ startDate: '2026-10-01', startTime: '09:00', endDate: '2026-10-05', endTime: '02:00' });
        expect([t.effectiveEndDate, t.effectiveEndTime]).toEqual(['2026-10-05', '02:00']);
    });

    it('a due-only task has the hour before its due as its span, and its due as stated', () => {
        const t = out({ due: '2026-10-04T17:00' });
        expect([t.effectiveStartDate, t.effectiveStartTime, t.effectiveEndDate, t.effectiveEndTime, t.effectiveDue, t.durationMinutes])
            .toEqual(['2026-10-04', '16:00', '2026-10-04', '17:00', '2026-10-04T17:00', 60]);
    });
});
