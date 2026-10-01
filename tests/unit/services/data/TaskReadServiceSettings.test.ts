import { describe, expect, it } from 'vitest';
import { TaskReadService } from '../../../../src/services/data/TaskReadService';
import type { IndexReads } from '../../../../src/services/core/TaskIndex';
import { makeTask } from '../../helpers/makeTask';

describe('TaskReadService reads the settings at each question', () => {
    const task = makeTask({ id: 't', startDate: '2026-10-01' });
    const index = {
        getRevision: () => 1,
        getTasks: () => [task],
        getTask: (id: string) => (id === 't' ? task : undefined),
    } as unknown as IndexReads;

    it('redraws the cached copies when startHour changes, with nothing pushed in', () => {
        const settings = { startHour: 5, weekStartDay: 1 as const };
        const read = new TaskReadService(index, () => settings);

        const before = read.getAllDisplayTasks();
        expect(read.getAllDisplayTasks()).toBe(before);

        settings.startHour = 0;
        const after = read.getAllDisplayTasks();
        expect(after).not.toBe(before);
        expect(after[0]).toEqual(read.getDisplayTask('t'));
        expect(after[0].effectiveEndTime).not.toBe(before[0].effectiveEndTime);
    });
});
