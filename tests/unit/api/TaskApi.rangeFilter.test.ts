import { describe, it, expect, vi } from 'vitest';
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
        getTasksForDateRange: vi.fn().mockReturnValue([]),
        getStartHour: vi.fn().mockReturnValue(5),
    };
    const mockPlugin = {
        app: { vault: { getAbstractFileByPath: vi.fn() } },
        settings: { startHour: 5, weekStartDay: 1 as const },
        getTaskReadService: () => mockReadService,
        getTaskWriteService: () => ({}),
    };
    return { api: new TaskApi(mockPlugin as any), mockReadService };
}

describe('tasksForDateRange: simple filters never touch the date window', () => {
    it('passes a FilterState built from the simple fields, with no startDate/endDate condition', async () => {
        const { api, mockReadService } = createMockApi();
        await api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31', status: 'x' });

        expect(mockReadService.getTasksForDateRange).toHaveBeenCalledTimes(1);
        const [from, to, filterState] = mockReadService.getTasksForDateRange.mock.calls[0];
        expect(from).toBe('2026-03-01');
        expect(to).toBe('2026-03-31');
        const properties = filterState.filters.map((f: { property: string }) => f.property);
        expect(properties).toEqual(['status']);
    });

    it('no simple fields → the filter argument is undefined, from/to still the caller\'s own', async () => {
        const { api, mockReadService } = createMockApi();
        await api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31' });

        const [from, to, filterState] = mockReadService.getTasksForDateRange.mock.calls[0];
        expect(from).toBe('2026-03-01');
        expect(to).toBe('2026-03-31');
        expect(filterState).toBeUndefined();
    });

    it('params.filter overrides simple fields, same precedence as list', async () => {
        const { api, mockReadService } = createMockApi();
        const explicit = { filters: [{ property: 'status' as const, operator: 'includes' as const, value: ['x'] }], logic: 'and' as const };
        await api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31', status: 'zzz', filter: explicit });

        const [, , filterState] = mockReadService.getTasksForDateRange.mock.calls[0];
        expect(filterState).toBe(explicit);
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

        const [from, to, filterState] = mockReadService.getTasksForDateRange.mock.calls[0];
        expect(from).toBe('2026-03-01');
        expect(to).toBe('2026-03-31');
        const properties = filterState.filters.map((f: { property: string }) => f.property);
        expect(properties).toEqual(['tag']);
    });

    it('no simple fields → the filter argument is undefined', async () => {
        const { api, mockReadService } = createMockApi();
        await api.categorizedTasksForDateRange({ from: '2026-03-01', to: '2026-03-31' });

        const [, , filterState] = mockReadService.getTasksForDateRange.mock.calls[0];
        expect(filterState).toBeUndefined();
    });
});
