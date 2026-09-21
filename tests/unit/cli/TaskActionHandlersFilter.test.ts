import { describe, it, expect, vi } from 'vitest';
import {
    createTasksForDateRangeHandler,
    createCategorizedTasksForDateRangeHandler,
} from '../../../src/cli/handlers/TaskActionHandlers';
import { cliDataToSimpleFilterFields } from '../../../src/cli/handlers/TaskQueryHandlers';

function createMockPlugin(apiOverride: Record<string, any> = {}) {
    return {
        api: {
            tasksForDateRange: vi.fn().mockResolvedValue({ total: 0, count: 0, truncated: false, limit: 100, tasks: [] }),
            categorizedTasksForDateRange: vi.fn().mockResolvedValue({}),
            ...apiOverride,
        },
    } as any;
}

describe('cliDataToSimpleFilterFields', () => {
    it('maps the simple flags, excluding date/from/to/filter/filter-file/list', () => {
        const result = cliDataToSimpleFilterFields({
            status: 'x,-',
            tag: '#work,#reading',
            file: 'daily.md',
            content: '会議',
            due: 'today',
            leaf: 'true',
            property: 'priority:high',
            color: 'red,blue',
            type: 'taskviewer',
            root: 'true',
            // These must never leak through this helper.
            date: '2026-03-15',
            from: '2026-03-01',
            to: '2026-03-31',
            'filter-file': 'x.json',
            list: 'urgent',
        });
        expect(result).toEqual({
            status: ['x', '-'],
            tag: ['work', 'reading'],
            file: 'daily.md',
            content: '会議',
            due: 'today',
            leaf: true,
            property: 'priority:high',
            color: 'red,blue',
            type: 'taskviewer',
            root: true,
        });
        expect(result).not.toHaveProperty('date');
        expect(result).not.toHaveProperty('from');
        expect(result).not.toHaveProperty('to');
    });

    it('returns an empty object when no simple flags are present', () => {
        expect(cliDataToSimpleFilterFields({ from: '2026-03-01', to: '2026-03-31' })).toEqual({});
    });
});

describe('createTasksForDateRangeHandler: wires simple filter flags into the API call', () => {
    it('passes status/tag through to plugin.api.tasksForDateRange', async () => {
        const plugin = createMockPlugin();
        const handler = createTasksForDateRangeHandler(plugin);
        await handler({ from: '2026-03-01', to: '2026-03-31', status: 'x', tag: 'work' });

        expect(plugin.api.tasksForDateRange).toHaveBeenCalledTimes(1);
        const callArgs = plugin.api.tasksForDateRange.mock.calls[0][0];
        expect(callArgs.from).toBe('2026-03-01');
        expect(callArgs.to).toBe('2026-03-31');
        expect(callArgs.status).toEqual(['x']);
        expect(callArgs.tag).toEqual(['work']);
    });

    it('passes filter-file/list through as filterFile/list', async () => {
        const plugin = createMockPlugin();
        const handler = createTasksForDateRangeHandler(plugin);
        await handler({ from: '2026-03-01', to: '2026-03-31', 'filter-file': 'template.md', list: 'urgent' });

        const callArgs = plugin.api.tasksForDateRange.mock.calls[0][0];
        expect(callArgs.filterFile).toBe('template.md');
        expect(callArgs.list).toBe('urgent');
    });

    it('omits filterFile/list when not given (not sent as empty strings)', async () => {
        const plugin = createMockPlugin();
        const handler = createTasksForDateRangeHandler(plugin);
        await handler({ from: '2026-03-01', to: '2026-03-31' });

        const callArgs = plugin.api.tasksForDateRange.mock.calls[0][0];
        expect(callArgs.filterFile).toBeUndefined();
        expect(callArgs.list).toBeUndefined();
    });
});

describe('createCategorizedTasksForDateRangeHandler: wires simple filter flags into the API call', () => {
    it('passes status/tag/filter-file/list through to plugin.api.categorizedTasksForDateRange', async () => {
        const plugin = createMockPlugin();
        const handler = createCategorizedTasksForDateRangeHandler(plugin);
        await handler({ from: '2026-03-01', to: '2026-03-31', status: 'x', 'filter-file': 'template.md' });

        expect(plugin.api.categorizedTasksForDateRange).toHaveBeenCalledTimes(1);
        const callArgs = plugin.api.categorizedTasksForDateRange.mock.calls[0][0];
        expect(callArgs.from).toBe('2026-03-01');
        expect(callArgs.to).toBe('2026-03-31');
        expect(callArgs.status).toEqual(['x']);
        expect(callArgs.filterFile).toBe('template.md');
    });
});
