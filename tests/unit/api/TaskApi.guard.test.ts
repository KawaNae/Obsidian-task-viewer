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

describe('C2: status 単一文字検証', () => {
    it('create: 多文字 status を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.create({ file: 'test.md', content: 'task', status: 'done' }))
            .rejects.toThrow(/status must be a single character/);
    });

    it('create: 空文字 status はデフォルト空白に fallback', async () => {
        const api = createMockApi(undefined);
        // status='' → fallback to ' ' (1 char), so no status error
        try {
            await api.create({ file: 'test.md', content: 'task', status: '' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/status must be/);
        }
    });

    it('update: 多文字 status を拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.update({ id: 'test-1', status: 'done' }))
            .rejects.toThrow(/status must be a single character/);
    });

    it('update: "none" は許可（空白に変換）', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        try {
            await api.update({ id: 'test-1', status: 'none' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/status must be/);
        }
    });

    it('createTvFile: 多文字 status を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.createTvFile({ content: 'task', status: 'ab' }))
            .rejects.toThrow(/status must be a single character/);
    });

    it('create: 単一文字 "x" は通過', async () => {
        const api = createMockApi(undefined);
        try {
            await api.create({ file: 'test.md', content: 'task', status: 'x' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/status must be/);
        }
    });
});

describe('C4: createTvFile 日付検証統一', () => {
    it('不正な start 日付を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.createTvFile({ content: 'task', start: 'invalid' }))
            .rejects.toThrow(/Invalid date format for start/);
    });

    it('不正な end 日付を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.createTvFile({ content: 'task', end: 'invalid' }))
            .rejects.toThrow(/Invalid date format for end/);
    });

    it('due の time-only 入力を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.createTvFile({ content: 'task', due: '14:00' }))
            .rejects.toThrow(/due must include a date/);
    });

    it('正しい日付は通過', async () => {
        const api = createMockApi(undefined);
        const result = await api.createTvFile({ content: 'task', start: '2026-07-18' });
        expect(result.newFile).toBe('new.md');
    });
});

describe('C5: update due の time-only 拒否', () => {
    it('due="14:00" は拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.update({ id: 'test-1', due: '14:00' }))
            .rejects.toThrow(/due must include a date/);
    });

    it('due="2026-07-18" は通過', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        try {
            await api.update({ id: 'test-1', due: '2026-07-18' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/due must include a date/);
        }
    });

    it('due="none" は通過（due クリア）', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        try {
            await api.update({ id: 'test-1', due: 'none' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/due must include a date/);
        }
    });
});
