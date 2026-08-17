import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice, setMockLocale } from 'obsidian';
import { initI18n } from '../../../src/i18n';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { parseFlowSegments, singleLineFlow } from '../../../src/services/flow/FlowSegments';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { DEFAULT_SETTINGS, Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

function makeRepository() {
    return {
        insertRecurrenceForTask: vi.fn().mockResolvedValue(undefined),
        appendTaskWithChildren: vi.fn().mockResolvedValue(undefined),
        updateTaskInFile: vi.fn().mockResolvedValue(undefined),
        stripFlow: vi.fn().mockResolvedValue(undefined),
        deleteTaskFromFile: vi.fn().mockResolvedValue(undefined),
    };
}

function makeTaskIndex(resolved: (task: Task) => Task | undefined) {
    return {
        waitForScan: vi.fn().mockResolvedValue(undefined),
        resolveTask: vi.fn((t: Task) => resolved(t)),
        requestScan: vi.fn().mockResolvedValue(undefined),
        notifyImmediate: vi.fn(),
    };
}

const app = { vault: { getAbstractFileByPath: () => null } };

function makeExecutor(repository: ReturnType<typeof makeRepository>, resolved: (task: Task) => Task | undefined = t => t) {
    const taskIndex = makeTaskIndex(resolved);
    const executor = new FlowExecutor(
        repository as unknown as TaskRepository,
        taskIndex as unknown as TaskIndex,
        app as never,
        () => DEFAULT_SETTINGS
    );
    return { executor, taskIndex };
}

function flowTask(src: string, overrides: Partial<Task> = {}): Task {
    return makeTask({
        statusChar: 'x',
        startDate: '2026-06-29',
        originalText: '- [x] Test task',
        flow: singleLineFlow(src),
        ...overrides,
    });
}

async function flush() {
    // Drain the fire-and-forget queue (all awaited promises are resolved mocks)
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('FlowExecutor', () => {
    it('fires repeat: inserts the next instance, then strips the command', async () => {
        const repository = makeRepository();
        const { executor, taskIndex } = makeExecutor(repository);
        const task = flowTask('every mon');

        await executor.handleTaskCompletion(task);
        await flush();

        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(1);
        const [origArg, lineArg, flowLinesArg] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(origArg).toBe(task);
        expect(lineArg).toContain('==> every mon');
        expect(flowLinesArg).toEqual([]);

        expect(repository.stripFlow).toHaveBeenCalledTimes(1);
        expect(repository.stripFlow).toHaveBeenCalledWith(task);
        expect(repository.updateTaskInFile).not.toHaveBeenCalled();

        // Order: insert BEFORE strip (line resolution depends on originalText)
        expect(repository.insertRecurrenceForTask.mock.invocationCallOrder[0])
            .toBeLessThan(repository.stripFlow.mock.invocationCallOrder[0]);

        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
        expect(taskIndex.notifyImmediate).toHaveBeenCalled();
    });

    it('fires a multi-line flow: child segments travel as flowLines, telomere decremented', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        const raws = ['every mon', 'setDue(start + 3d)', 'x3'];
        const { program, diagnostics } = parseFlowSegments(raws);
        const task = flowTask('every mon', {
            flow: {
                raw: raws[0],
                childSegments: raws.slice(1).map((raw, i) => ({ raw, bodyLine: i + 1 })),
                program,
                diagnostics,
            },
        });

        await executor.handleTaskCompletion(task);
        await flush();

        const [, line, flowLines] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(line).toContain('==> every mon');
        expect(line).not.toContain('setDue');
        expect(flowLines).toEqual(['setDue(start + 3d)', 'x2']);
        expect(repository.stripFlow).toHaveBeenCalledTimes(1);
    });

    it('fires move: archives then deletes the original (no strip)', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        const task = flowTask('move([[Archive]])');

        await executor.handleTaskCompletion(task);
        await flush();

        expect(repository.appendTaskWithChildren).toHaveBeenCalledTimes(1);
        const [dest, line] = repository.appendTaskWithChildren.mock.calls[0];
        expect(dest).toBe('Archive.md');
        expect(line).not.toContain('==>');
        expect(repository.deleteTaskFromFile).toHaveBeenCalledTimes(1);
        expect(repository.updateTaskInFile).not.toHaveBeenCalled();
        expect(repository.appendTaskWithChildren.mock.invocationCallOrder[0])
            .toBeLessThan(repository.deleteTaskFromFile.mock.invocationCallOrder[0]);
    });

    it('does not fire for non-complete statuses (Doing)', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('every mon', { statusChar: '/' }));
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
    });

    it('re-checks after resolve: unchecked task is skipped', async () => {
        const repository = makeRepository();
        const task = flowTask('every mon');
        // Resolution returns the task already unchecked (race: check → uncheck)
        const { executor } = makeExecutor(repository, t => ({ ...t, statusChar: ' ' }));

        await executor.handleTaskCompletion(task);
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
    });

    it('consumes without generating when until has expired', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('every mon until(2026-06-30)'));
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).toHaveBeenCalledTimes(1);
    });

    it('leaves the command intact on runtime eval failure', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        // `end` is unset on the task → EvalError at fire time
        await executor.handleTaskCompletion(flowTask('every mon setDue(end + 1d)'));
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
    });

    it('processes the queue sequentially with a rescan await between tasks', async () => {
        const repository = makeRepository();
        const { executor, taskIndex } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d)', { content: 'A', originalText: '- [x] A' }));
        await executor.handleTaskCompletion(flowTask('at(today + 1d)', { content: 'B', originalText: '- [x] B' }));
        await flush();

        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(2);
        expect(taskIndex.waitForScan).toHaveBeenCalledTimes(2);
    });

    it('decrements the telomere in the generated line', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d) x3'));
        await flush();

        const [, line] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(line).toContain('==> at(today + 1d) x2');
    });

    it('x1: generated line carries no command', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d) x1'));
        await flush();

        const [, line] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(line).not.toContain('==>');
    });
});

describe('a fire that does not happen says so', () => {
    // 非発火・非消費は設計どおりだが、外から見えるのは「チェックしても何も
    // 起きないチェックボックス」。ログしか残らないと、タスクを触っている人
    // には何も届かない。
    beforeEach(() => {
        Notice.messages.length = 0;
    });

    /** `end` is unset on the task, so the expression fails while it runs. */
    const failing = () => flowTask('at(end + 1d)', { file: 'notes/週報.md' });

    it('shows what stopped it, and which file it was in', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(failing());
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain("Property 'end' is not set on this task");
        expect(Notice.messages[0]).toContain('週報');
    });

    it('says it once while the same task keeps failing the same way', async () => {
        // 直すために付けたり外したりする間、同じ文言が積み上がるとファイル
        // 自体が見えなくなる。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(failing());
        await flush();
        await executor.handleTaskCompletion(failing());
        await flush();

        expect(Notice.messages).toHaveLength(1);
    });

    it('says the next failure, since it is a different thing to fix', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(failing());
        await flush();
        // 同じタスクの別の失敗。窓は「同じ失敗」に効くのであって、
        // 「そのタスクを黙らせる」ためのものではない。
        await executor.handleTaskCompletion(
            flowTask('at(due + 1d)', { file: 'notes/週報.md' }));
        await flush();

        expect(Notice.messages).toHaveLength(2);
        expect(Notice.messages[1]).toContain("Property 'due' is not set on this task");
    });

    it('says it in the reader language', async () => {
        // 理由の英文はエンジンが投げた場所で書かれている。通知はそれをそのまま
        // 出すのではなく code で引き直すので、日本語の vault では日本語になる。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        setMockLocale('ja');
        initI18n();
        try {
            await executor.handleTaskCompletion(failing());
            await flush();
        } finally {
            setMockLocale('en');
            initI18n();
        }

        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain("このタスクにプロパティ 'end' は設定されていません");
    });

    it('stays quiet when the fire went through', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d)'));
        await flush();

        expect(Notice.messages).toEqual([]);
    });
});

describe('fireAndDelete', () => {
    // 削除は「コマンドを消費するもう一つの道」。行ごと消えるので strip の
    // 出番はなく、生成だけを先に済ませてから消す。
    beforeEach(() => {
        Notice.messages.length = 0;
    });

    it('writes the next instance, then deletes the original', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        const task = flowTask('every mon', { statusChar: ' ' });

        await executor.fireAndDelete(task);

        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(1);
        expect(repository.deleteTaskFromFile).toHaveBeenCalledWith(task);
        // 行の特定は originalText 照合なので、読む側が済むまで元行は動かせない。
        expect(repository.insertRecurrenceForTask.mock.invocationCallOrder[0])
            .toBeLessThan(repository.deleteTaskFromFile.mock.invocationCallOrder[0]);
        // 行ごと消えるのだから、コマンドを剥がす書き込みは無駄でしかない。
        expect(repository.stripFlow).not.toHaveBeenCalled();
    });

    it('fires an unchecked task: deletion is not a completion', async () => {
        // handleTaskCompletion なら statusChar ' ' で門前払いされる経路。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(1);
    });

    it('does not archive a move: a delete was not a request to keep a copy', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon move([[Archive]])', { statusChar: ' ' }));

        expect(repository.appendTaskWithChildren).not.toHaveBeenCalled();
        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(1);
        expect(repository.deleteTaskFromFile).toHaveBeenCalledTimes(1);
    });

    it('deletes without generating when until has expired', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon until(2026-06-30)', { statusChar: ' ' }));

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.deleteTaskFromFile).toHaveBeenCalledTimes(1);
    });

    it('keeps the task when the fire fails, and says why', async () => {
        // 発火できないコマンドは行の上に残っており、その行が消える寸前だった。
        // ここで消すと、残そうとしたものをちょうど失う。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon setDue(end + 1d)', { statusChar: ' ' }));

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain('the task was not deleted');
    });

    it('resolves only after the work is done, so the caller can rescan', async () => {
        const repository = makeRepository();
        const { executor, taskIndex } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        // await が返った時点で書き込みも再スキャン要求も済んでいる。
        expect(repository.deleteTaskFromFile).toHaveBeenCalledTimes(1);
        expect(taskIndex.waitForScan).toHaveBeenCalledTimes(1);
    });

    it('resolves even when the task is gone from the index', async () => {
        // 待ち手を残したまま返らないと、呼んだメニューがそのまま固まる。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, () => undefined);

        await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
    });

    it('resolves even when a write throws', async () => {
        const repository = makeRepository();
        repository.insertRecurrenceForTask.mockRejectedValueOnce(new Error('disk on fire'));
        const { executor } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
    });

    it('runs behind a completion already in the queue', async () => {
        // 同じ行を書き換える二つの道が並ぶと、古いインデックスに対する二重生成に
        // なる。順番待ちは一本のキューが担う。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        const completion = executor.handleTaskCompletion(
            flowTask('every mon', { content: 'A', originalText: '- [x] A' }));
        const deletion = executor.fireAndDelete(
            flowTask('every tue', { content: 'B', originalText: '- [ ] B', statusChar: ' ' }));
        await Promise.all([completion, deletion]);

        expect(repository.stripFlow.mock.invocationCallOrder[0])
            .toBeLessThan(repository.deleteTaskFromFile.mock.invocationCallOrder[0]);
    });
});
