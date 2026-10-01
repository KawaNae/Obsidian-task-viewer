import { describe, it, expect, vi } from 'vitest';
import { SortSerializer } from '../../../src/services/sort/SortSerializer';
import { TaskApi } from '../../../src/api/TaskApi';

describe('SortSerializer.parse', () => {
    it('reads rules with a known property and direction, `asc` when none is given', () => {
        expect(SortSerializer.parse({ rules: [{ property: 'due', direction: 'desc' }, { property: 'tag' }] })).toEqual({
            state: { rules: [{ property: 'due', direction: 'desc' }, { property: 'tag', direction: 'asc' }] },
            issues: [],
        });
    });

    it('does not read an id a rule was saved with, and does not write one', () => {
        const { state } = SortSerializer.parse({ rules: [{ id: 's-1-abc', property: 'file', direction: 'asc' }] });
        expect(state).toEqual({ rules: [{ property: 'file', direction: 'asc' }] });
        expect(SortSerializer.toJSON(state)).toEqual({ rules: [{ property: 'file', direction: 'asc' }] });
    });

    it('drops a rule it cannot read and says which and why', () => {
        const { state, issues } = SortSerializer.parse({
            rules: [{ property: 'duee' }, { property: 'due', direction: 'up' }, 'content', { property: 'content' }],
        });
        expect(state).toEqual({ rules: [{ property: 'content', direction: 'asc' }] });
        expect(issues).toEqual([
            { at: 'rules[0]', reason: 'Unknown sort property: duee. Available: content, due, startDate, endDate, file, status, tag' },
            { at: 'rules[1]', reason: 'Invalid sort direction: up. Use asc or desc' },
            { at: 'rules[2]', reason: 'not a sort rule ({ property, direction })' },
        ]);
    });

    it('a value with no rules list is no sort, with an issue', () => {
        expect(SortSerializer.parse({})).toEqual({ state: { rules: [] }, issues: [{ at: 'sort', reason: 'not a sort ({ rules })' }] });
    });
});

describe('the API reads `sort` with SortSerializer', () => {
    function api() {
        const read = { getFilteredTasks: vi.fn().mockReturnValue([]) };
        const plugin = {
            app: {},
            settings: { startHour: 0, weekStartDay: 1 as const },
            getTaskReadService: () => read,
            getIndex: () => read,
            getOperations: () => ({}),
        };
        return { api: new TaskApi(plugin as never), read };
    }

    it('passes the rules on without IDs', async () => {
        const { api: a, read } = api();
        await a.list({ status: 'x', sort: [{ property: 'due', direction: 'desc' }, { property: 'file' }] });
        expect(read.getFilteredTasks.mock.calls[0][1]).toEqual({
            rules: [{ property: 'due', direction: 'desc' }, { property: 'file', direction: 'asc' }],
        });
    });

    it('refuses a rule it cannot read', async () => {
        const { api: a } = api();
        await expect(a.list({ sort: [{ property: 'due', direction: 'descc' as never }] }))
            .rejects.toThrow(/Invalid sort: rules\[0\]: Invalid sort direction: descc\. Use asc or desc/);
    });
});
