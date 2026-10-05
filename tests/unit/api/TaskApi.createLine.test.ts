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
}): { api: TaskApi; readService: any; operations: any } {
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
        tasksInWindow: vi.fn().mockReturnValue([]),
    };
    const operations = {
        createTask: vi.fn().mockResolvedValue(opts.insertedLine),
        updateTask: vi.fn(),
        deleteTask: vi.fn(),
        duplicateTask: vi.fn(),
        insertLine: vi.fn(),
    };
    const mockPlugin = {
        app: {
            vault: {
                getAbstractFileByPath: vi.fn().mockReturnValue(mockFile),
            },
        },
        settings: { startHour: 0 },
        getTaskReadService: () => readService,
        getIndex: () => readService,
        getOperations: () => operations,
    };
    return { api: new TaskApi(mockPlugin as any), readService, operations };
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
        const { api, readService, operations } = createMockApiForCreate({
            insertedLine: 3,
            createdTask: newTask,
        });
        const result = await api.create({
            file: 'test.md',
            content: 'same content',
            heading: 'Tasks',
        });
        expect(operations.createTask).toHaveBeenCalledWith(
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

describe('the line create and insertChildTask write', () => {
    // Parts join one space apart with their ends trimmed, as format() joins
    // them, so a trailing space in the content leaves nothing behind.
    it('create writes one space between the content and the date block', async () => {
        const { api, operations } = createMockApiForCreate({
            insertedLine: 5,
            createdTask: makeFullTask({ line: 5 }),
        });
        await api.create({ file: 'test.md', content: 'task ', start: '2026-07-18' });
        expect(operations.createTask).toHaveBeenCalledWith('test.md', '- [ ] task @2026-07-18', undefined);
    });

    it('insertChildTask writes the content with its end trimmed', async () => {
        const { api, readService, operations } = createMockApiForCreate({
            insertedLine: 5,
            createdTask: undefined,
        });
        readService.getTask.mockReturnValue(makeFullTask({ id: 'parent-1' }));
        operations.insertLine.mockResolvedValue({ written: true });
        await api.insertChildTask({ parentId: 'parent-1', content: 'child ' });
        expect(operations.insertLine).toHaveBeenCalledWith('parent-1', '- [ ] child', 'firstChild');
    });
});

describe('the date block create writes', () => {
    const written = async (params: { start?: string; end?: string; due?: string }): Promise<string> => {
        const { api, operations } = createMockApiForCreate({
            insertedLine: 5,
            createdTask: makeFullTask({ line: 5 }),
        });
        await api.create({ file: 'test.md', content: 't', ...params });
        return operations.createTask.mock.calls[0][1];
    };

    it.each([
        [{ start: '2026-07-18' }, '- [ ] t @2026-07-18'],
        [{ start: '2026-07-18 09:00' }, '- [ ] t @2026-07-18T09:00'],
        [{ start: '09:00' }, '- [ ] t @09:00'],
        [{ start: '2026-07-18', end: '2026-07-20' }, '- [ ] t @2026-07-18>2026-07-20'],
        [{ start: '2026-07-18 09:00', end: '2026-07-20 10:00' }, '- [ ] t @2026-07-18T09:00>2026-07-20T10:00'],
        [{ start: '2026-07-18 09:00', end: '10:00' }, '- [ ] t @2026-07-18T09:00>10:00'],
        [{ end: '2026-07-20' }, '- [ ] t @>2026-07-20'],
        [{ due: '2026-07-25' }, '- [ ] t @>>2026-07-25'],
        [{ start: '2026-07-18', due: '2026-07-25' }, '- [ ] t @2026-07-18>>2026-07-25'],
        [{ start: '2026-07-18', end: '2026-07-20', due: '2026-07-25' }, '- [ ] t @2026-07-18>2026-07-20>2026-07-25'],
    ])('%j -> %j', async (params, line) => {
        expect(await written(params)).toBe(line);
    });

    // The block is formatTaskLine's, as every other line the plugin writes.
    // A due keeps its time (the hand-built block dropped it), an end on the
    // start's own day is written the notation's way.
    it.each([
        [{ start: '2026-07-18', due: '2026-07-25 17:00' }, '- [ ] t @2026-07-18>>2026-07-25T17:00'],
        [{ start: '2026-07-18 09:00', end: '2026-07-18 10:00' }, '- [ ] t @2026-07-18T09:00>10:00'],
        [{ start: '2026-07-18', end: '2026-07-18' }, '- [ ] t @2026-07-18'],
    ])('%j -> %j', async (params, line) => {
        expect(await written(params)).toBe(line);
    });

    // The values are read as typed text (stage 7, input decisions B, C, D):
    // an hour of one digit is written with two, full-width and hyphen-like
    // characters are read as ASCII.
    it.each([
        [{ start: '2026-07-18 9:40' }, '- [ ] t @2026-07-18T09:40'],
        [{ start: '9:40', end: '10:05' }, '- [ ] t @09:40>10:05'],
        [{ start: '２０２６－０７－１８　９：４０' }, '- [ ] t @2026-07-18T09:40'],
        [{ start: '2026ー07ー18' }, '- [ ] t @2026-07-18'],
        [{ due: '2026-07-25T9:00' }, '- [ ] t @>>2026-07-25T09:00'],
    ])('%j -> %j', async (params, line) => {
        expect(await written(params)).toBe(line);
    });

    // A due with no date was dropped without a word; it is refused, as
    // update refuses it.
    it('tells a due of the wrong shape the shapes a due takes, a time alone not among them', async () => {
        await expect(written({ due: 'tomorrow' }))
            .rejects.toThrow('due must be a date (YYYY-MM-DD) or a date and a time (YYYY-MM-DD HH:mm), got: "tomorrow"');
        await expect(written({ start: 'tomorrow' }))
            .rejects.toThrow('start must be a date (YYYY-MM-DD), a date and a time (YYYY-MM-DD HH:mm), or a time (HH:mm), got: "tomorrow"');
    });

    it('refuses a due that is a time alone', async () => {
        await expect(written({ start: '2026-07-18', due: '17:00' }))
            .rejects.toThrow(/due must include a date, got: "17:00"/);
    });

    it.each([
        [{ start: '2026-02-30' }, /start must be a day that exists, got: "2026-02-30"/],
        [{ start: '2026-13-45' }, /start must be a day that exists/],
        [{ end: '2026-07-18T99:99' }, /end must be a date \(YYYY-MM-DD\), a date and a time/],
        [{ due: '2026-02-29' }, /due must be a day that exists/],
        [{ start: '2026/07/18' }, /start must be a date/],
    ])('refuses %j', async (params, message) => {
        await expect(written(params)).rejects.toThrow(message);
    });
});
