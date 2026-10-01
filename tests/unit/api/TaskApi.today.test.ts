import { describe, it, expect, vi } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
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

function apiOver(tasks: Task[]) {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const lookup = (id: string) => byId.get(id);
    const displayTasks = tasks.map(t => toDisplayTask(t, 5, lookup));
    const readService = {
        getTask: vi.fn(lookup),
        getAllDisplayTasks: vi.fn().mockReturnValue(displayTasks),
    };
    const plugin = {
        app: {},
        settings: { startHour: 5, weekStartDay: 1 as const },
        getTaskReadService: () => readService,
        getIndex: () => readService,
        getOperations: () => ({}),
    };
    return new TaskApi(plugin as any);
}

// `leaf` means what the filter's `children isNotSet` means: no child task the
// index holds. A child ID it cannot resolve is no child, so a task with only
// such IDs is a leaf (`today` used to count the IDs themselves).
describe('today: leaf', () => {
    it('keeps the tasks with no child task the index holds', () => {
        const today = DateUtils.getVisualDateOfNow(5);
        const api = apiOver([
            makeTask('parent', { startDate: today, childIds: ['child'] }),
            makeTask('child', { startDate: today, line: 1, parentId: 'parent' }),
            makeTask('orphaned', { startDate: today, line: 2, childIds: ['gone'] }),
            makeTask('lines-only', { startDate: today, line: 3, childLines: [{ text: '- plain', bodyLine: 4, indent: '    ', wikilinkTarget: null, propertyKey: null, propertyValue: null }] }),
        ]);
        const ids = api.today({ leaf: true }).tasks.map(t => t.content).sort();
        expect(ids).toEqual(['child', 'lines-only', 'orphaned']);
    });
});
