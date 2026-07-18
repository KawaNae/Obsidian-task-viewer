import { describe, it, expect, vi } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskApiError } from '../../../src/api/TaskApiTypes';
import type { Task, DisplayTask } from '../../../src/types';
import { TFile } from 'obsidian';

function makeFullTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'created-1',
        file: 'test.md',
        line: 5,
        content: 'new task',
        statusChar: ' ',
        parserId: 'tv-inline',
        isReadOnly: false,
        tags: [],
        childLines: [],
        childIds: [],
        originalText: '- [ ] new task',
        indent: 0,
        properties: {},
        ...overrides,
    } as Task;
}

function createMockApiForCreate(opts: {
    insertedLine: number;
    createdTask: Task | undefined;
}): { api: TaskApi; readService: any; writeService: any } {
    const mockFile = Object.create(TFile.prototype);
    const readService = {
        getTask: vi.fn().mockReturnValue(undefined),
        getTaskByFileLine: vi.fn().mockImplementation(
            (_file: string, line: number) =>
                line === opts.insertedLine ? opts.createdTask : undefined
        ),
        getTasks: vi.fn().mockReturnValue([]),
        getAllDisplayTasks: vi.fn().mockReturnValue([]),
        getFilteredTasks: vi.fn().mockReturnValue([]),
        getTasksForDateRange: vi.fn().mockReturnValue([]),
    };
    const writeService = {
        createTask: vi.fn().mockResolvedValue(opts.insertedLine),
        updateTask: vi.fn(),
        deleteTask: vi.fn(),
        duplicateTask: vi.fn(),
        insertChildTask: vi.fn(),
        convertToTvFile: vi.fn().mockResolvedValue('new.md'),
        createTvFileFromData: vi.fn().mockResolvedValue('new.md'),
    };
    const mockPlugin = {
        app: {
            vault: {
                getAbstractFileByPath: vi.fn().mockReturnValue(mockFile),
            },
        },
        settings: { startHour: 0 },
        getTaskReadService: () => readService,
        getTaskWriteService: () => writeService,
    };
    return { api: new TaskApi(mockPlugin as any), readService, writeService };
}

describe('G4: create の行番号ベース再特定', () => {
    it('通常の create (append) で getTaskByFileLine が insertedLine で呼ばれる', async () => {
        const created = makeFullTask({ line: 10 });
        const { api, readService } = createMockApiForCreate({
            insertedLine: 10,
            createdTask: created,
        });
        const result = await api.create({ file: 'test.md', content: 'new task' });
        expect(readService.getTaskByFileLine).toHaveBeenCalledWith('test.md', 10);
        expect(result.task.id).toBe('created-1');
    });

    it('heading 指定 + 同一 content 既存タスクありで新タスクが返る（content 検索廃止の証明）', async () => {
        const newTask = makeFullTask({ id: 'new-1', line: 3, content: 'same content' });
        const { api, readService, writeService } = createMockApiForCreate({
            insertedLine: 3,
            createdTask: newTask,
        });
        const result = await api.create({
            file: 'test.md',
            content: 'same content',
            heading: 'Tasks',
        });
        expect(writeService.createTask).toHaveBeenCalledWith(
            'test.md',
            expect.stringContaining('- [ ] same content'),
            'Tasks',
        );
        expect(readService.getTaskByFileLine).toHaveBeenCalledWith('test.md', 3);
        expect(result.task.id).toBe('new-1');
    });

    it('content に連続空白を含んでも行番号ベースで成功', async () => {
        const created = makeFullTask({ line: 5, content: 'task with  spaces' });
        const { api } = createMockApiForCreate({
            insertedLine: 5,
            createdTask: created,
        });
        const result = await api.create({ file: 'test.md', content: 'task with  spaces' });
        expect(result.task).toBeDefined();
    });

    it('content に @date block を含んでも行番号ベースで成功', async () => {
        const created = makeFullTask({ line: 5, content: 'task' });
        const { api } = createMockApiForCreate({
            insertedLine: 5,
            createdTask: created,
        });
        const result = await api.create({
            file: 'test.md',
            content: 'task',
            start: '2026-07-18',
        });
        expect(result.task).toBeDefined();
    });

    it('scan 後にタスクが見つからない場合はエラー', async () => {
        const { api } = createMockApiForCreate({
            insertedLine: 5,
            createdTask: undefined,
        });
        await expect(
            api.create({ file: 'test.md', content: 'task' })
        ).rejects.toThrow(/could not be found after scan/);
    });

    it('content 一致検索（getTasks）は呼ばれない', async () => {
        const created = makeFullTask({ line: 7 });
        const { api, readService } = createMockApiForCreate({
            insertedLine: 7,
            createdTask: created,
        });
        await api.create({ file: 'test.md', content: 'task' });
        expect(readService.getTasks).not.toHaveBeenCalled();
    });
});
