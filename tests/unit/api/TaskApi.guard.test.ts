import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskApiError } from '../../../src/api/TaskApiTypes';
import type { Task } from '../../../src/types';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'test-1',
        file: 'test.md',
        line: 1,
        content: 'test task',
        statusChar: ' ',
        parserId: 'tasks-plugin',
        isReadOnly: false,
        tags: [],
        childLines: [],
        ...overrides,
    } as Task;
}

function createMockApi(task: Task | undefined): TaskApi {
    const mockReadService = {
        getTask: vi.fn().mockReturnValue(task),
        getTasks: vi.fn().mockReturnValue(task ? [task] : []),
        getAllDisplayTasks: vi.fn().mockReturnValue([]),
        getFilteredTasks: vi.fn().mockReturnValue([]),
        getTasksForDateRange: vi.fn().mockReturnValue([]),
    };
    const mockWriteService = {
        updateTask: vi.fn(),
        deleteTask: vi.fn(),
        duplicateTask: vi.fn(),
        insertChildTask: vi.fn(),
        createTask: vi.fn(),
        convertToTvFile: vi.fn().mockResolvedValue('new.md'),
        createTvFileFromData: vi.fn().mockResolvedValue('new.md'),
    };
    const mockPlugin = {
        app: { vault: { getAbstractFileByPath: vi.fn() } },
        settings: { startHour: 0 },
        getTaskReadService: () => mockReadService,
        getTaskWriteService: () => mockWriteService,
    };
    return new TaskApi(mockPlugin as any);
}

describe('C1: read-only タスクの mutation 拒否', () => {
    const readOnlyTask = makeTask({ isReadOnly: true, parserId: 'tasks-plugin' });

    it('update は read-only タスクを拒否し parserId を含むエラーを返す', async () => {
        const api = createMockApi(readOnlyTask);
        await expect(api.update({ id: 'test-1', content: 'new' }))
            .rejects.toThrow(TaskApiError);
        await expect(api.update({ id: 'test-1', content: 'new' }))
            .rejects.toThrow(/read-only.*parserId=tasks-plugin/);
    });

    it('delete は read-only タスクを拒否', async () => {
        const api = createMockApi(readOnlyTask);
        await expect(api.delete({ id: 'test-1' }))
            .rejects.toThrow(/read-only.*parserId=tasks-plugin/);
    });

    it('duplicate は read-only タスクを拒否', async () => {
        const api = createMockApi(readOnlyTask);
        await expect(api.duplicate({ id: 'test-1' }))
            .rejects.toThrow(/read-only.*parserId=tasks-plugin/);
    });

    it('insertChildTask は read-only タスクを拒否', async () => {
        const api = createMockApi(readOnlyTask);
        await expect(api.insertChildTask({ parentId: 'test-1', content: 'child' }))
            .rejects.toThrow(/read-only.*parserId=tasks-plugin/);
    });

    it('day-planner parserId も正しくエラーに含まれる', async () => {
        const dpTask = makeTask({ isReadOnly: true, parserId: 'day-planner' });
        const api = createMockApi(dpTask);
        await expect(api.delete({ id: 'test-1' }))
            .rejects.toThrow(/parserId=day-planner/);
    });

    it('isReadOnly=false のタスクは read-only エラーを出さない', async () => {
        const writableTask = makeTask({ isReadOnly: false, parserId: 'tv-inline' });
        const api = createMockApi(writableTask);
        try {
            await api.update({ id: 'test-1', content: 'new' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/read-only/);
        }
    });
});
