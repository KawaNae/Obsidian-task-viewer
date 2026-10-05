import { describe, it, expect, vi } from 'vitest';
import { daysWindow } from '../../../src/utils/DayWindow';
import { TaskApi } from '../../../src/api/TaskApi';

/**
 * Pins the guarantee at the API layer (not just the CLI handler): a caller
 * of tasksForDateRange/categorizedTasksForDateRange can pass simple filter
 * fields alongside the required from/to without those ever turning into an
 * extra startDate/endDate condition on top of the range's own window. The
 * CLI handler tests alone wouldn't catch a regression from someone calling
 * plugin.api.tasksForDateRange(...) directly.
 */
function createMockApi() {
    const mockReadService = {
        getTask: vi.fn(),
        getTasks: vi.fn().mockReturnValue([]),
        getAllDisplayTasks: vi.fn().mockReturnValue([]),
        getFilteredTasks: vi.fn().mockReturnValue([]),
        tasksInWindow: vi.fn().mockReturnValue([]),
    };
    const mockPlugin = {
        app: { vault: { getAbstractFileByPath: vi.fn() } },
        settings: { startHour: 5, weekStartDay: 1 as const },
        getTaskReadService: () => mockReadService,
        getIndex: () => mockReadService,
        getOperations: () => ({}),
    };
    return { api: new TaskApi(mockPlugin as any), mockReadService };
}

describe('tasksForDateRange: simple filters never touch the date window', () => {
    it('passes a FilterState built from the simple fields, with no startDate/endDate condition', async () => {
        const { api, mockReadService } = createMockApi();
        await api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31', status: 'x' });

        expect(mockReadService.tasksInWindow).toHaveBeenCalledTimes(1);
        const [window, filterState] = mockReadService.tasksInWindow.mock.calls[0];
        expect(window).toEqual(daysWindow('2026-03-01', '2026-03-31', 5));
        const properties = filterState.filters.map((f: { property: string }) => f.property);
        expect(properties).toEqual(['status']);
    });

    it('no simple fields → the filter argument is undefined, the window still the caller\'s own', async () => {
        const { api, mockReadService } = createMockApi();
        await api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31' });

        const [window, filterState] = mockReadService.tasksInWindow.mock.calls[0];
        expect(window).toEqual(daysWindow('2026-03-01', '2026-03-31', 5));
        expect(filterState).toBeUndefined();
    });

    it('params.filter and the simple fields are taken together, as in list', async () => {
        const { api, mockReadService } = createMockApi();
        const explicit = { filters: [{ property: 'status' as const, operator: 'includes' as const, value: ['x'] }], logic: 'and' as const };
        await api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31', status: 'zzz', filter: explicit });

        const [, filterState] = mockReadService.tasksInWindow.mock.calls[0];
        expect(filterState).toEqual({ logic: 'and', filters: [explicit, { property: 'status', operator: 'includes', value: ['zzz'] }] });
    });

    it('list= without filterFile throws, same as list', async () => {
        const { api } = createMockApi();
        await expect(api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31', list: 'urgent' }))
            .rejects.toThrow(/requires 'filterFile'/);
    });
});

describe('categorizedTasksForDateRange: simple filters never touch the date window', () => {
    it('passes a FilterState built from the simple fields, with no startDate/endDate condition', async () => {
        const { api, mockReadService } = createMockApi();
        await api.categorizedTasksForDateRange({ from: '2026-03-01', to: '2026-03-31', tag: 'work' });

        const [window, filterState] = mockReadService.tasksInWindow.mock.calls[0];
        expect(window).toEqual(daysWindow('2026-03-01', '2026-03-31', 5));
        const properties = filterState.filters.map((f: { property: string }) => f.property);
        expect(properties).toEqual(['tag']);
    });

    it('no simple fields → the filter argument is undefined', async () => {
        const { api, mockReadService } = createMockApi();
        await api.categorizedTasksForDateRange({ from: '2026-03-01', to: '2026-03-31' });

        const [, filterState] = mockReadService.tasksInWindow.mock.calls[0];
        expect(filterState).toBeUndefined();
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
        expect(mockReadService.tasksInWindow).not.toHaveBeenCalled();
    });

    it('reads a full-width bound', async () => {
        const { api, mockReadService } = createMockApi();
        await api.tasksForDateRange({ from: '２０２６－０３－０１', to: '2026ー03ー31' });
        const [window] = mockReadService.tasksInWindow.mock.calls[0];
        expect(window).toEqual(daysWindow('2026-03-01', '2026-03-31', 5));
    });
});
