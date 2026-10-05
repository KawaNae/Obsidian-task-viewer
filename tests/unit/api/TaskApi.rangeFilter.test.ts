import { describe, it, expect, vi } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';

/**
 * The range operations are list with from and to, both required: their
 * window is a period overlaps condition taken together with the rest of
 * the query, the one FilterState handed to getFilteredTasks. Pinned at the
 * API (not just the CLI handler), as a script calls it.
 */
function createMockApi() {
    const mockReadService = {
        getFilteredTasks: vi.fn().mockReturnValue([]),
        windowContext: vi.fn((startHour: number) => ({ startHour, weekStartDay: 1, taskLookup: () => undefined, now: new Date() })),
    };
    const mockPlugin = {
        app: { vault: { getAbstractFileByPath: vi.fn() } },
        settings: { startHour: 5, weekStartDay: 1 as const },
        getTaskReadService: () => mockReadService,
        getIndex: () => ({ getTask: () => undefined }),
        getOperations: () => ({}),
    };
    return { api: new TaskApi(mockPlugin as any), mockReadService };
}

const MARCH = { property: 'period', operator: 'overlaps', value: { from: '2026-03-01', to: '2026-03-31' } };

describe.each([
    ['tasksForDateRange', (api: TaskApi, p: any) => api.tasksForDateRange(p)],
    ['categorizedTasksForDateRange', (api: TaskApi, p: any) => api.categorizedTasksForDateRange(p)],
] as const)('%s: the window is list\'s from and to', (_name, call) => {
    it('hands the window and the simple fields over as one FilterState', async () => {
        const { api, mockReadService } = createMockApi();
        await call(api, { from: '2026-03-01', to: '2026-03-31', status: 'x' });
        expect(mockReadService.getFilteredTasks).toHaveBeenCalledTimes(1);
        const [filterState, , options] = mockReadService.getFilteredTasks.mock.calls[0];
        expect(filterState).toEqual({ logic: 'and', filters: [{ property: 'status', operator: 'includes', value: ['x'] }, MARCH] });
        expect(options).toEqual({ includeInvalid: true });
    });

    it('takes filter together with the window', async () => {
        const { api, mockReadService } = createMockApi();
        const explicit = { filters: [{ property: 'status' as const, operator: 'includes' as const, value: ['x'] }], logic: 'and' as const };
        await call(api, { from: '2026-03-01', to: '2026-03-31', status: 'zzz', filter: explicit });
        const [filterState] = mockReadService.getFilteredTasks.mock.calls[0];
        expect(filterState).toEqual({ logic: 'and', filters: [explicit, { property: 'status', operator: 'includes', value: ['zzz'] }, MARCH] });
    });

    it('list= without filterFile throws, same as list', async () => {
        const { api } = createMockApi();
        await expect(call(api, { from: '2026-03-01', to: '2026-03-31', list: 'urgent' }))
            .rejects.toThrow(/requires 'filterFile'/);
    });

    it('refuses a from after its to', async () => {
        const { api } = createMockApi();
        await expect(call(api, { from: '2026-03-31', to: '2026-03-01' }))
            .rejects.toThrow('from 2026-03-31 is after to 2026-03-01');
    });
});

/**
 * The range's own bounds are read as the filter's dates are (stage 7,
 * input decision B): a day that exists, typed text normalized.
 */
describe('the range bounds', () => {
    it('refuses a bound that names no day', async () => {
        const { api, mockReadService } = createMockApi();
        await expect(api.tasksForDateRange({ from: '2026-02-30', to: '2026-03-31' }))
            .rejects.toThrow(/from must be a day that exists, got: "2026-02-30"/);
        await expect(api.categorizedTasksForDateRange({ from: '2026-03-01', to: '2026-04-31' }))
            .rejects.toThrow(/to must be a day that exists/);
        expect(mockReadService.getFilteredTasks).not.toHaveBeenCalled();
    });

    it('reads a full-width bound', async () => {
        const { api, mockReadService } = createMockApi();
        await api.tasksForDateRange({ from: '２０２６－０３－０１', to: '2026ー03ー31' });
        const [filterState] = mockReadService.getFilteredTasks.mock.calls[0];
        expect(filterState.filters).toEqual([MARCH]);
    });

    it('lays out every visual day of the window, a preset\'s whole span', async () => {
        const { api } = createMockApi();
        const result = await api.categorizedTasksForDateRange({ from: '2026-03-01', to: '2026-03-03' });
        expect(Object.keys(result)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    });
});
