import { describe, it, expect } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * A query's startHour (stage 11e): the visual day boundary of that call
 * alone, for the copies' spans, the windows and the effective times. The
 * setting is 5.
 */
function apiOver(tasks: Task[]) {
    const index = {
        getRevision: () => 1,
        getTasks: () => tasks,
        getTask: (id: string) => tasks.find(t => t.id === id),
    };
    const settings = { startHour: 5, weekStartDay: 1 as const };
    const read = new TaskReadService(index as never, () => settings);
    const api = new TaskApi({
        app: {},
        settings,
        getTaskReadService: () => read,
        getIndex: () => index,
        getOperations: () => ({}),
    } as never);
    return { api, read };
}

const night = makeTask({ id: 'night', content: 'night', startDate: '2026-10-05', startTime: '03:00' });
const day = makeTask({ id: 'day', content: 'day', line: 1, startDate: '2026-10-04' });

const contents = (r: { tasks: { content: string }[] }) => r.tasks.map(t => t.content).sort();

describe('startHour moves the visual day of one query', () => {
    it('places a night\'s task on the day before by the setting, on its own day at 0', async () => {
        const { api } = apiOver([night, day]);
        expect(contents(await api.list({ date: '2026-10-04' }))).toEqual(['day', 'night']);
        expect(contents(await api.list({ date: '2026-10-04', startHour: 0 }))).toEqual(['day']);
        expect(contents(await api.list({ date: '2026-10-05', startHour: 0 }))).toEqual(['night']);
    });

    it('gives get the effective times of that start hour', async () => {
        const { api } = apiOver([day]);
        const [{ id }] = (await api.list()).tasks;
        expect(api.get({ id })).toMatchObject({ effectiveStartTime: '05:00', effectiveEndDate: '2026-10-05', effectiveEndTime: '05:00', durationMinutes: 1440 });
        expect(api.get({ id, startHour: 0 })).toMatchObject({
            effectiveStartDate: '2026-10-04', effectiveStartTime: '00:00',
            effectiveEndDate: '2026-10-05', effectiveEndTime: '00:00', durationMinutes: 1440,
        });
    });

    it('takes the range operations\' start hour too', async () => {
        const { api } = apiOver([night, day]);
        expect(contents(await api.tasksForDateRange({ from: '2026-10-05', to: '2026-10-05', startHour: 0 }))).toEqual(['night']);
        const days = await api.categorizedTasksForDateRange({ from: '2026-10-04', to: '2026-10-05', startHour: 0 });
        expect(days['2026-10-05'].timed.map(t => t.content)).toEqual(['night']);
    });
});

describe('the start hour a query takes', () => {
    it.each([
        [24, 'startHour must be from 0 to 23, got: "24"'],
        [-1, 'startHour must be from 0 to 23, got: "-1"'],
        [5.5, 'startHour must be a whole number, got: "5.5"'],
    ])('refuses %s', async (startHour, message) => {
        const { api } = apiOver([day]);
        await expect(api.list({ startHour })).rejects.toThrow(message);
        await expect(api.today({ startHour })).rejects.toThrow(message);
        expect(() => api.get({ id: 'any', startHour })).toThrow(message);
    });
});

describe('the copies of another start hour are not kept', () => {
    it('leaves the setting\'s cached copies as they were', async () => {
        const { api, read } = apiOver([night, day]);
        const cached = read.getAllDisplayTasks();
        expect(read.displayTasksAt(5)).toBe(cached);

        await api.list({ startHour: 0 });
        expect(read.getAllDisplayTasks()).toBe(cached);
        expect(contents(await api.list({ date: '2026-10-04' }))).toEqual(['day', 'night']);
    });
});
