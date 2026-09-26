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

function createMockApi(task: Task | undefined, opts: { writesLand?: boolean } = {}): TaskApi {
    const lands = opts.writesLand !== false;
    const mockReadService = {
        getTask: vi.fn().mockReturnValue(task),
        getTasks: vi.fn().mockReturnValue(task ? [task] : []),
        getAllDisplayTasks: vi.fn().mockReturnValue([]),
        getFilteredTasks: vi.fn().mockReturnValue([]),
        getTasksForDateRange: vi.fn().mockReturnValue([]),
    };
    // 変更系は「書けた」を返す。API は書けなかった write をエラーにするので、
    // 既定の undefined のままだとパラメータ検証のケースが書き込み失敗で落ちる。
    const mockWriteService = {
        updateTask: vi.fn().mockResolvedValue(lands),
        deleteTask: vi.fn().mockResolvedValue(lands),
        duplicateTask: vi.fn().mockResolvedValue(lands),
        insertLine: vi.fn().mockResolvedValue(lands),
        createTask: vi.fn().mockResolvedValue(lands ? 0 : null),
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


    it('create: 単一文字 "x" は通過', async () => {
        const api = createMockApi(undefined);
        try {
            await api.create({ file: 'test.md', content: 'task', status: 'x' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/status must be/);
        }
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

describe('C8: 数値パラメータ検証', () => {
    it('duplicate: NaN dayOffset を拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.duplicate({ id: 'test-1', dayOffset: NaN }))
            .rejects.toThrow(/dayOffset must be a number/);
    });

    it('duplicate: 文字列 dayOffset を拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.duplicate({ id: 'test-1', dayOffset: 'abc' as any }))
            .rejects.toThrow(/dayOffset must be a number/);
    });

    it('duplicate: NaN count を拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.duplicate({ id: 'test-1', count: NaN }))
            .rejects.toThrow(/count must be a number/);
    });

    it('duplicate: count=0 を拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.duplicate({ id: 'test-1', count: 0 }))
            .rejects.toThrow(/count must be at least 1/);
    });

    it('duplicate: 負の count を拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.duplicate({ id: 'test-1', count: -1 }))
            .rejects.toThrow(/count must be at least 1/);
    });

    it('duplicate: 正常な値は通過', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        const result = await api.duplicate({ id: 'test-1', dayOffset: 1, count: 2 });
        expect(result.duplicated).toBe('test-1');
    });

    it('list: NaN limit を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.list({ limit: NaN }))
            .rejects.toThrow(/limit must be a number/);
    });

    it('list: 負の limit を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.list({ limit: -1 }))
            .rejects.toThrow(/limit must be non-negative/);
    });

    it('list: 文字列 limit を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.list({ limit: 'abc' as any }))
            .rejects.toThrow(/limit must be a number/);
    });
});

describe('C11: list= を filterFile なしで渡すとエラー', () => {
    it('list に filterFile なしで list= を渡すとエラー', async () => {
        const api = createMockApi(undefined);
        await expect(api.list({ list: 'urgent' }))
            .rejects.toThrow(/list requires filterFile/);
    });

    it('filterFile ありの list= は通過', async () => {
        const api = createMockApi(undefined);
        // filterFile のファイル読み込みで失敗するが、list 検証は通過
        try {
            await api.list({ filterFile: 'template.md', list: 'urgent' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/list requires filterFile/);
        }
    });
});

describe('C17: content の改行注入拒否', () => {
    it('create: 改行入り content を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.create({ file: 'test.md', content: 'line1\nline2' }))
            .rejects.toThrow(/content must not contain line breaks/);
    });

    it('insertChildTask: 改行入り content を拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.insertChildTask({ parentId: 'test-1', content: 'line1\nline2' }))
            .rejects.toThrow(/content must not contain line breaks/);
    });

    it('update: 改行入り content を拒否', async () => {
        const task = makeTask({ isReadOnly: false });
        const api = createMockApi(task);
        await expect(api.update({ id: 'test-1', content: 'line1\nline2' }))
            .rejects.toThrow(/content must not contain line breaks/);
    });

    it('create: 改行なし content は通過', async () => {
        const api = createMockApi(undefined);
        try {
            await api.create({ file: 'test.md', content: 'simple task' });
        } catch (e) {
            expect((e as Error).message).not.toMatch(/line break/);
        }
    });
});

/**
 * A write the plugin could not place — a line it can no longer resolve, a note
 * whose terminators it once could not read (#176) — used to come back as a
 * success: update returned the task read straight back out of the index, which
 * had already been reverted, and delete and duplicate returned nothing at all
 * to check. The API is the CLI's only story about what happened, so it says so.
 */
describe('C18: 書けなかった変更系はエラーになる', () => {
    it('update: 書けなかったら失敗を返す', async () => {
        const api = createMockApi(makeTask(), { writesLand: false });
        await expect(api.update({ id: 'test-1', status: 'x' }))
            .rejects.toThrow(/could not be written/);
    });

    it('delete: 消せなかったら失敗を返す', async () => {
        const api = createMockApi(makeTask(), { writesLand: false });
        await expect(api.delete({ id: 'test-1' }))
            .rejects.toThrow(/could not be deleted/);
    });

    it('duplicate: 複製できなかったら失敗を返す', async () => {
        const api = createMockApi(makeTask(), { writesLand: false });
        await expect(api.duplicate({ id: 'test-1' }))
            .rejects.toThrow(/could not be duplicated/);
    });

    it('insertChildTask: 子を書けなかったら失敗を返す', async () => {
        const api = createMockApi(makeTask(), { writesLand: false });
        await expect(api.insertChildTask({ parentId: 'test-1', content: 'child' }))
            .rejects.toThrow(/could not be written/);
    });
});

describe('F5: 1要素1行。改行を含む値は、書き込みの前に理由を添えて拒否する', () => {
    // The write layer refuses such a line whole (LineBreakInLine); the API
    // says which parameter it was before anything is written.
    it('create: CR だけの content を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.create({ file: 'test.md', content: 'line1\rline2' }))
            .rejects.toThrow(/content must not contain line breaks/);
    });

    it('update: CR だけの content を拒否', async () => {
        const api = createMockApi(makeTask({ isReadOnly: false }));
        await expect(api.update({ id: 'test-1', content: 'line1\rline2' }))
            .rejects.toThrow(/content must not contain line breaks/);
    });

    it('insertChildTask: CR だけの content を拒否', async () => {
        const api = createMockApi(makeTask({ isReadOnly: false }));
        await expect(api.insertChildTask({ parentId: 'test-1', content: 'line1\rline2' }))
            .rejects.toThrow(/content must not contain line breaks/);
    });

    it('create: 改行の status を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.create({ file: 'test.md', content: 'task', status: '\n' }))
            .rejects.toThrow(/status must be a single character a checkbox can hold/);
        await expect(api.create({ file: 'test.md', content: 'task', status: '\r' }))
            .rejects.toThrow(/status must be a single character a checkbox can hold/);
    });

    it('status の U+2028 と U+2029 を拒否（Obsidian はそのチェックボックスをタスクと読まない）', async () => {
        const created = createMockApi(undefined);
        const existing = createMockApi(makeTask({ isReadOnly: false }));
        for (const sep of [' ', ' ']) {
            await expect(created.create({ file: 'test.md', content: 'task', status: sep }))
                .rejects.toThrow(/status must be a single character a checkbox can hold/);
            await expect(existing.update({ id: 'test-1', status: sep }))
                .rejects.toThrow(/status must be a single character a checkbox can hold/);
        }
    });

    it('status は文字列に限る（数や toString を持つ値を文字に直して書かない）', async () => {
        const created = createMockApi(undefined);
        const existing = createMockApi(makeTask({ isReadOnly: false }));
        for (const bad of [5, { toString: () => 'y' }]) {
            await expect(created.create({ file: 'test.md', content: 'task', status: bad as unknown as string }))
                .rejects.toThrow(/status must be a single character a checkbox can hold/);
            await expect(existing.update({ id: 'test-1', status: bad as unknown as string }))
                .rejects.toThrow(/status must be a single character a checkbox can hold/);
        }
    });

    it('update: 改行の status を拒否', async () => {
        const api = createMockApi(makeTask({ isReadOnly: false }));
        await expect(api.update({ id: 'test-1', status: '\n' }))
            .rejects.toThrow(/status must be a single character a checkbox can hold/);
    });

    it('create: 改行を含む heading を拒否', async () => {
        const api = createMockApi(undefined);
        await expect(api.create({ file: 'test.md', content: 'task', heading: 'Tasks\n- [ ] injected' }))
            .rejects.toThrow(/heading must not contain line breaks/);
        await expect(api.create({ file: 'test.md', content: 'task', heading: 'Tasks\rx' }))
            .rejects.toThrow(/heading must not contain line breaks/);
    });

    it('単独の CR は改行として拒否（エディタが行を割るため）', async () => {
        const created = createMockApi(undefined);
        const existing = createMockApi(makeTask({ isReadOnly: false }));
        await expect(created.create({ file: 'test.md', content: 'a\rb' }))
            .rejects.toThrow(/content must not contain line breaks/);
        await expect(existing.update({ id: 'test-1', content: 'a\rb' }))
            .rejects.toThrow(/content must not contain line breaks/);
        await expect(existing.update({ id: 'test-1', status: '\r' }))
            .rejects.toThrow(/status must be a single character a checkbox can hold/);
    });

    it('U+2028 と U+2029 は行の中身として通し、そのまま書き込みへ渡す（L1。Obsidian も読み手も行の区切りにしない）', async () => {
        for (const sep of ['\u2028', '\u2029']) {
            const created = createMockApi(undefined);
            const existing = createMockApi(makeTask({ isReadOnly: false }));
            const write = (existing as any).plugin.getTaskWriteService();
            // What the mock task lacks for the result does not matter here: the
            // value reached the write, unchanged.
            await existing.update({ id: 'test-1', content: `a${sep}b` }).catch(() => undefined);
            expect(write.updateTask).toHaveBeenCalledWith('test-1', expect.objectContaining({ content: `a${sep}b` }));
            // create checks the file after the values: getting that far means the values passed.
            await expect(created.create({ file: 'test.md', content: `a${sep}b`, heading: `T${sep}x` }))
                .rejects.toThrow(/File not found/);
        }
    });
});
