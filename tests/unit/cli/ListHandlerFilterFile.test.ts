import { describe, it, expect, vi } from 'vitest';
import { createListHandler } from '../../../src/cli/handlers/TaskQueryHandlers';
import { TaskApi } from '../../../src/api/TaskApi';

/**
 * The CLI's `list` hands a filter file and the list in it to the API as
 * they are; it reads no file of its own. What the API does beside a filter
 * file is what the CLI does.
 */
function pluginWith(list: (params: unknown) => Promise<unknown>) {
    return { api: { list: vi.fn(list) } } as never;
}

describe('the CLI list with a filter file', () => {
    it('passes filter-file and list to the API, with the other flags', async () => {
        const list = vi.fn(async () => ({ total: 0, count: 0, truncated: false, limit: 100, tasks: [] }));
        const plugin = { api: { list } } as never;
        await createListHandler(plugin)({ 'filter-file': 'templates/work.md', list: 'urgent', tag: 'home', date: 'today' });

        expect(list).toHaveBeenCalledTimes(1);
        expect(list.mock.calls[0][0]).toMatchObject({
            filterFile: 'templates/work.md',
            list: 'urgent',
            tag: ['home'],
            date: 'today',
        });
    });

    it('turns list= without filter-file away in the API\'s words, where it used to drop it', async () => {
        const read = { getAllDisplayTasks: () => [], getFilteredTasks: () => [] };
        const api = new TaskApi({
            app: {},
            settings: { startHour: 5, weekStartDay: 1 },
            getTaskReadService: () => read,
            getIndex: () => read,
            getOperations: () => ({}),
        } as never);
        const out = await createListHandler(pluginWith(params => api.list(params as never)))({ list: 'urgent' });

        expect(JSON.parse(out).error).toBe(`'list' requires 'filter-file' (a .md view template)`);
    });
});
