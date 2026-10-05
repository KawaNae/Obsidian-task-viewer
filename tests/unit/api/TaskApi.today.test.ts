import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { TaskApiError } from '../../../src/api/TaskApiTypes';
import { DateUtils } from '../../../src/utils/DateUtils';
import type { Task } from '../../../src/types';

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        file: 'note.md',
        line: 0,
        content: id,
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        originalText: `- [ ] ${id}`,
        tags: [],
        properties: {},
        parserId: 'tv-inline',
        ...overrides,
    } as Task;
}

/** The API over a real read service on `tasks` (startHour 5). */
function apiOver(tasks: Task[]) {
    const index = {
        getRevision: () => 1,
        getTasks: () => tasks,
        getTask: (id: string) => tasks.find(t => t.id === id),
    };
    const settings = { startHour: 5, weekStartDay: 1 as const };
    const readService = new TaskReadService(index as any, () => settings);
    const plugin = {
        app: {},
        settings,
        getTaskReadService: () => readService,
        getIndex: () => index,
        getOperations: () => ({}),
    };
    return new TaskApi(plugin as any);
}

afterEach(() => {
    vi.useRealTimers();
});

// `leaf` means what the filter's `children isNotSet` means: no child task the
// index holds. A child ID it cannot resolve is no child, so a task with only
// such IDs is a leaf (`today` used to count the IDs themselves).
describe('today: leaf', () => {
    it('keeps the tasks with no child task the index holds', async () => {
        const today = DateUtils.getVisualDateOfNow(5);
        const api = apiOver([
            makeTask('parent', { startDate: today, childIds: ['child'] }),
            makeTask('child', { startDate: today, line: 1, parentId: 'parent' }),
            makeTask('orphaned', { startDate: today, line: 2, childIds: ['gone'] }),
            makeTask('lines-only', { startDate: today, line: 3, childLines: [{ text: '- plain', bodyLine: 4, indent: '    ', wikilinkTarget: null, propertyKey: null, propertyValue: null }] }),
        ]);
        const ids = (await api.today({ leaf: true })).tasks.map(t => t.content).sort();
        expect(ids).toEqual(['child', 'lines-only', 'orphaned']);
    });
});

// Today is list date=today: it takes list's params, all but the window.
describe('today is list date=today', () => {
    it('takes a tag, as list does', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 4, 12, 0));
        const api = apiOver([
            makeTask('work', { startDate: '2026-10-04', tags: ['work'] }),
            makeTask('home', { startDate: '2026-10-04', line: 1, tags: ['home'] }),
            makeTask('work-tomorrow', { startDate: '2026-10-05', line: 2, tags: ['work'] }),
        ]);
        expect((await api.today({ tag: 'work' })).tasks.map(t => t.content)).toEqual(['work']);
        expect((await api.today()).tasks.map(t => t.content).sort()).toEqual(['home', 'work']);
        const listed = await api.list({ date: 'today', tag: 'work' });
        expect(listed.tasks.map(t => t.content)).toEqual(['work']);
    });

    it.each(['date', 'from', 'to'])('refuses %s, a window beside its own', async key => {
        const api = apiOver([]);
        const call = api.today({ [key]: '2026-10-10' } as never);
        await expect(call).rejects.toBeInstanceOf(TaskApiError);
        await expect(api.today({ [key]: '2026-10-10' } as never)).rejects
            .toThrow(`Cannot use '${key}' with today, which is date=today; use list ${key}=2026-10-10`);
    });
});
