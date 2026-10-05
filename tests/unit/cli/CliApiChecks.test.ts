import { describe, it, expect, vi } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { registerCliHandlers } from '../../../src/cli/CliRegistrar';
import { createGetHandler, createListHandler, createTodayHandler } from '../../../src/cli/handlers/TaskQueryHandlers';
import {
    createDuplicateHandler, createInsertChildTaskHandler, createTasksForDateRangeHandler,
} from '../../../src/cli/handlers/TaskActionHandlers';

/**
 * B#13b: whether a parameter is required and whether its value is one the
 * operation takes is checked once, by the API. The CLI turns the flags' text
 * into the API's types and tells the API's error with the parameters named
 * by their flags.
 */

function realApi() {
    const read = {
        getAllDisplayTasks: vi.fn().mockReturnValue([]),
        getFilteredTasks: vi.fn().mockReturnValue([]),
        tasksInWindow: vi.fn().mockReturnValue([]),
        getTask: vi.fn(),
    };
    const plugin = {
        app: { vault: { getAbstractFileByPath: vi.fn() } },
        settings: { startHour: 5, weekStartDay: 1 as const },
        getTaskReadService: () => read,
        getIndex: () => read,
        getOperations: () => ({}),
    };
    return { api: new TaskApi(plugin as never) };
}

const errorOf = (out: string) => (JSON.parse(out) as { error: string }).error;

describe('the API checks, the CLI tells in its flags', () => {
    it.each([
        ['insert-child-task', () => createInsertChildTaskHandler(realApi() as never)({ content: 'x' }), 'Missing required parameter: parent-id'],
        ['get', () => createGetHandler(realApi() as never)({}), 'Missing required parameter: id'],
        ['tasks-for-date-range', () => createTasksForDateRangeHandler(realApi() as never)({ to: 'today' }), 'Missing required parameter: from'],
    ])('%s: a required flag left out', async (_name, run, message) => {
        expect(errorOf(await run())).toBe(message);
    });

    it('duplicate: a count out of range, before the task is looked up', async () => {
        const out = await createDuplicateHandler(realApi() as never)({ id: 'a.md#^x', count: '0' });
        expect(errorOf(out)).toBe('count must be at least 1, got: "0"');
    });

    it('a listing: a limit out of range', async () => {
        const out = await createTasksForDateRangeHandler(realApi() as never)({ from: 'today', to: 'today', limit: '-1' });
        expect(errorOf(out)).toBe('limit must be at least 0, got: "-1"');
    });

    it('list= without filter-file, named as the flags are', async () => {
        const out = await createTasksForDateRangeHandler(realApi() as never)({ from: 'today', to: 'today', list: 'a' });
        expect(errorOf(out)).toBe("'list' requires 'filter-file' (a .md view template)");
    });

    it('the API itself names its keys', async () => {
        await expect(realApi().api.insertChildTask({ content: 'x' } as never)).rejects.toThrow('Missing required parameter: parentId');
    });
});

describe('start-hour', () => {
    const commands: [string, (p: Record<string, string>) => Promise<string>][] = [
        ['list', p => createListHandler(realApi() as never)(p)],
        ['today', p => createTodayHandler(realApi() as never)(p)],
        ['get', p => createGetHandler(realApi() as never)({ id: 'a.md#^x', ...p })],
        ['tasks-for-date-range', p => createTasksForDateRangeHandler(realApi() as never)({ from: 'today', to: 'today', ...p })],
    ];

    it.each(commands)('%s: a start hour out of range is the API\'s error, in the flag\'s name', async (_name, run) => {
        expect(errorOf(await run({ 'start-hour': '24' }))).toBe('start-hour must be from 0 to 23, got: "24"');
    });

    it.each(commands)('%s: a start hour that is no whole number is read as the flag', async (_name, run) => {
        expect(errorOf(await run({ 'start-hour': 'abc' }))).toBe('start-hour must be a whole number, got: "abc"');
    });
});

describe('today takes list\'s flags but the window', () => {
    it('hands tag, filter-file and start-hour over to the API', async () => {
        const today = vi.fn().mockResolvedValue({ total: 0, count: 0, truncated: false, limit: 100, tasks: [] });
        await createTodayHandler({ api: { today } } as never)({ tag: 'work', 'filter-file': 'f.json', 'start-hour': '0' });
        expect(today).toHaveBeenCalledWith({ tag: ['work'], filterFile: 'f.json', startHour: 0, limit: 100 });
    });

    it('refuses a window flag for what it is, before the API is asked', async () => {
        const today = vi.fn();
        const out = await createTodayHandler({ api: { today } } as never)({ date: '2026-10-10' });
        expect(errorOf(out)).toBe("Cannot use 'date' with today, which is date=today; use list date=2026-10-10");
        expect(today).not.toHaveBeenCalled();
    });

    it('refuses an unknown flag as every command does', async () => {
        const out = await createTodayHandler({ api: { today: vi.fn() } } as never)({ tagg: 'work' });
        expect(errorOf(out)).toBe('Unknown flag: tagg. Did you mean: tag?');
    });
});

describe('a flag given empty', () => {
    function handlers() {
        const map = new Map<string, (params: Record<string, string>) => Promise<string>>();
        const plugin = {
            ...realApi(),
            registerCliHandler: (name: string, _d: string, _f: unknown, handler: (p: Record<string, string>) => Promise<string>) => {
                map.set(name.replace('obsidian-task-viewer:', ''), handler);
            },
        };
        registerCliHandlers(plugin as never);
        return map;
    }

    it.each([
        ['duplicate', { id: 'a.md#^x', count: '' }, 'count'],
        ['duplicate', { id: 'a.md#^x', 'day-offset': '' }, 'day-offset'],
        ['list', { limit: '' }, 'limit'],
        ['list', { file: '' }, 'file'],
        ['list', { format: '' }, 'format'],
        ['get', { id: '' }, 'id'],
        ['update', { id: 'a.md#^x', content: '' }, 'content'],
        ['export-image', { view: 'timeline', width: '' }, 'width'],
        ['export-image', { view: 'timeline', date: '' }, 'date'],
    ])('%s %j is refused, not taken as left out', async (command, params, flag) => {
        expect(errorOf(await handlers().get(command)!(params))).toBe(`${flag} must not be empty`);
    });
});
