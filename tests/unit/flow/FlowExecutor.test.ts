import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice, setMockLocale } from 'obsidian';
import { initI18n } from '../../../src/i18n';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { parseFlowSegments, singleLineFlow } from '../../../src/services/flow/FlowSegments';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import type { TaskOp } from '../../../src/services/persistence/TaskOps';
import { targetOf } from '../../../src/services/persistence/TaskRefs';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS, Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { heldTasks } from '../helpers/heldTasks';

function makeRepository() {
    return {
        applyToTask: vi.fn().mockResolvedValue({ written: true, refused: null, made: [] }),
        insertRecurrenceForTask: vi.fn().mockResolvedValue(undefined),
        appendTaskWithChildren: vi.fn().mockResolvedValue(undefined),
        updateTaskInFile: vi.fn().mockResolvedValue(undefined),
        stripFlow: vi.fn().mockResolvedValue(undefined),
        deleteTaskFromFile: vi.fn().mockResolvedValue(true),
    };
}

function makeTaskIndex(tasks: ReturnType<typeof heldTasks>) {
    return {
        waitForScan: vi.fn().mockResolvedValue(undefined),
        getTask: tasks.getTask,
        requestScan: vi.fn().mockResolvedValue(undefined),
        notifyImmediate: vi.fn(),
    };
}

const app = { vault: { getAbstractFileByPath: () => null } };

function makeExecutor(repository: ReturnType<typeof makeRepository>, resolved: (task: Task) => Task | undefined = t => t) {
    const tasks = heldTasks(resolved);
    const taskIndex = makeTaskIndex(tasks);
    const executor = tasks.hold(new FlowExecutor(
        repository as unknown as TaskRepository,
        taskIndex as unknown as TaskIndex,
        app as never,
        () => DEFAULT_SETTINGS
    ));
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

/** The ops of the `n`th one-write fire. */
function opsOf(repository: ReturnType<typeof makeRepository>, n = 0): TaskOp[] {
    return repository.applyToTask.mock.calls[n][1] as TaskOp[];
}

/** The recurrence the `n`th fire inserts (fails the test if it inserts none). */
function recurrenceOf(repository: ReturnType<typeof makeRepository>, n = 0): { content: string; flowLines: string[] } {
    const op = opsOf(repository, n).find(o => o.kind === 'insert-instance');
    if (op?.kind !== 'insert-instance' || op.insert.kind !== 'recurrence') {
        throw new Error(`fire ${n} inserts no recurrence`);
    }
    return op.insert;
}

/** The ops of each one-write call that takes the row away: the deletion fires. */
function deletionsOf(repository: ReturnType<typeof makeRepository>): TaskOp[][] {
    return repository.applyToTask.mock.calls
        .map(c => c[1] as TaskOp[])
        .filter(ops => ops.some(o => o.kind === 'remove'));
}

/** Every op of `kind` across all one-write fires. */
function opsOfKind(repository: ReturnType<typeof makeRepository>, kind: TaskOp['kind']): TaskOp[] {
    return repository.applyToTask.mock.calls.flatMap(c => (c[1] as TaskOp[]).filter(o => o.kind === kind));
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

        // One write for the whole fire, naming the row that fired.
        expect(repository.applyToTask).toHaveBeenCalledTimes(1);
        const [target, ops] = repository.applyToTask.mock.calls[0];
        expect(target).toEqual(targetOf(task));

        // Order: insert BEFORE strip, as the ops of that one write.
        expect(ops.map((o: TaskOp) => o.kind)).toEqual(['insert-instance', 'strip-flow']);
        const { content, flowLines } = recurrenceOf(repository);
        expect(content).toContain('==> every mon');
        expect(flowLines).toEqual([]);
        // The strip rewrites the fired row to itself without its command.
        expect(ops[1]).toEqual({ kind: 'strip-flow', text: TaskParser.format({ ...task, flow: undefined }).trim() });

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
        expect(repository.updateTaskInFile).not.toHaveBeenCalled();

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

        const { content: line, flowLines } = recurrenceOf(repository);
        expect(line).toContain('==> every mon');
        expect(line).not.toContain('setDue');
        expect(flowLines).toEqual(['setDue(start + 3d)', 'x2']);
        expect(opsOfKind(repository, 'strip-flow')).toHaveLength(1);
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

    it('says so when the move wrote the copy but could not delete the original', async () => {
        // 移送先には書かれたので、元が消せないとタスクが2か所に居る。move で
        // これだけは画面に何も出ないまま起きるので、通知で伝える。
        const repository = makeRepository();
        repository.deleteTaskFromFile.mockResolvedValue(false);
        const { executor } = makeExecutor(repository);
        Notice.messages.length = 0;

        await executor.handleTaskCompletion(flowTask('move([[Archive]])'));
        await flush();

        expect(repository.appendTaskWithChildren).toHaveBeenCalledTimes(1);
        expect(Notice.messages).toHaveLength(1);
    });

    it('does not fire for non-complete statuses (Doing)', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('every mon', { statusChar: '/' }));
        await flush();

        expect(repository.applyToTask).not.toHaveBeenCalled();
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

        expect(repository.applyToTask).not.toHaveBeenCalled();
        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
    });

    it('consumes without generating when until has expired', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('every mon until(2026-06-30)'));
        await flush();

        expect(repository.applyToTask).toHaveBeenCalledTimes(1);
        expect(opsOf(repository).map(o => o.kind)).toEqual(['strip-flow']);
        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
    });

    it('leaves the command intact on runtime eval failure', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        // `end` is unset on the task → EvalError at fire time
        await executor.handleTaskCompletion(flowTask('every mon setDue(end + 1d)'));
        await flush();

        expect(repository.applyToTask).not.toHaveBeenCalled();
        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
    });

    it('processes the queue sequentially with a rescan await between tasks', async () => {
        const repository = makeRepository();
        const { executor, taskIndex } = makeExecutor(repository);

        // Two rows, so two names: the executor looks each up by its ID.
        await executor.handleTaskCompletion(flowTask('at(today + 1d)', { id: 'tv-inline:note.md:A', content: 'A', originalText: '- [x] A' }));
        await executor.handleTaskCompletion(flowTask('at(today + 1d)', { id: 'tv-inline:note.md:B', content: 'B', originalText: '- [x] B' }));
        await flush();

        expect(repository.applyToTask).toHaveBeenCalledTimes(2);
        expect(opsOfKind(repository, 'insert-instance')).toHaveLength(2);
        expect(taskIndex.waitForScan).toHaveBeenCalledTimes(2);
    });

    it('decrements the telomere in the generated line', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d) x3'));
        await flush();

        const { content: line } = recurrenceOf(repository);
        expect(line).toContain('==> at(today + 1d) x2');
    });

    it('x1: generated line carries no command', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d) x1'));
        await flush();

        const { content: line } = recurrenceOf(repository);
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

        expect(repository.applyToTask).not.toHaveBeenCalled();
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

    it('writes the next instance and takes the original away in one write', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        const task = flowTask('every mon', { statusChar: ' ' });

        await executor.fireAndDelete(task);

        // 挿入と削除を分けると、2本目が originalText で行を探し直すことになる。
        // 次回分は元の行と同じ本文になりうるので、その探索は当てにできない。
        expect(repository.applyToTask).toHaveBeenCalledTimes(1);
        expect(repository.applyToTask).toHaveBeenCalledWith(targetOf(task), [
            { kind: 'insert-instance', insert: expect.objectContaining({ kind: 'recurrence' }) },
            { kind: 'remove' },
        ]);
        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
        // 行ごと消えるのだから、コマンドを剥がす書き込みは無駄でしかない。
        expect(repository.stripFlow).not.toHaveBeenCalled();
    });

    it('fires an unchecked task: deletion is not a completion', async () => {
        // handleTaskCompletion なら statusChar ' ' で門前払いされる経路。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        expect(deletionsOf(repository).map(ops => ops.map(o => o.kind)))
            .toEqual([['insert-instance', 'remove']]);
    });

    it('does not archive a move: a delete was not a request to keep a copy', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon move([[Archive]])', { statusChar: ' ' }));

        expect(repository.appendTaskWithChildren).not.toHaveBeenCalled();
        expect(deletionsOf(repository).map(ops => ops.map(o => o.kind)))
            .toEqual([['insert-instance', 'remove']]);
    });

    it('deletes without generating when until has expired', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon until(2026-06-30)', { statusChar: ' ' }));

        // 書くものが無いだけで、消す1本は同じ呼び出しで出る。
        expect(deletionsOf(repository)).toEqual([[{ kind: 'remove' }]]);
    });

    it('keeps the task when the fire fails, and says why', async () => {
        // 発火できないコマンドは行の上に残っており、その行が消える寸前だった。
        // ここで消すと、残そうとしたものをちょうど失う。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        const removed = await executor.fireAndDelete(
            flowTask('every mon setDue(end + 1d)', { statusChar: ' ' }));

        expect(removed).toBe(false);
        expect(repository.applyToTask).not.toHaveBeenCalled();
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain('the task was not deleted');
    });

    it('reports the task gone when it deleted it', async () => {
        // 呼んだ側はこの答えでパネルを閉じるかを決める。書き込んだかどうかでは
        // なく、タスクが消えたかどうかを聞いている。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        const fired = await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));
        const expired = await executor.fireAndDelete(
            flowTask('every mon until(2026-06-30)', { statusChar: ' ' }));

        expect(fired).toBe(true);
        expect(expired).toBe(true);
    });

    it('reports the task still there when the write found no line', async () => {
        // 行が解決できなければ次回分も書かれていない。タスクは消えていないので
        // 答えは no。ユーザーへの通知は書き込みを拒否した側（TaskIndex.reportRefusal）
        // が一度だけ出すので、ここでは出さない。呼んだ側が黙って再試行しても
        // 二重には書かれないが、消えたと思わせるわけにはいかない。
        const repository = makeRepository();
        repository.applyToTask.mockResolvedValue({
            written: false, refused: { file: 'note.md', reason: { kind: 'gone' }, subject: 'Test task' }, made: [],
        });
        const { executor } = makeExecutor(repository);
        Notice.messages.length = 0;

        const removed = await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        expect(removed).toBe(false);
        expect(Notice.messages).toHaveLength(0);
    });

    it('resolves only after the work is done, so the caller can rescan', async () => {
        const repository = makeRepository();
        const { executor, taskIndex } = makeExecutor(repository);

        await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        // await が返った時点で書き込みも再スキャン要求も済んでいる。
        expect(repository.applyToTask).toHaveBeenCalledTimes(1);
        expect(taskIndex.waitForScan).toHaveBeenCalledTimes(1);
    });

    it('resolves even when the task is gone from the index', async () => {
        // 待ち手を残したまま返らないと、呼んだメニューがそのまま固まる。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, () => undefined);

        const removed = await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        // 解決できない行は既に無い行で、それは呼んだ側が求めていた状態そのもの。
        expect(removed).toBe(true);
        expect(repository.applyToTask).not.toHaveBeenCalled();
    });

    it('resolves even when a write throws', async () => {
        const repository = makeRepository();
        repository.applyToTask.mockRejectedValueOnce(new Error('disk on fire'));
        const { executor } = makeExecutor(repository);

        const removed = await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        expect(removed).toBe(false);
    });

    it('runs behind a completion already in the queue', async () => {
        // 同じ行を書き換える二つの道が並ぶと、古いインデックスに対する二重生成に
        // なる。順番待ちは一本のキューが担う。
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        // Two rows, so two names: the executor looks each up by its ID.
        const completion = executor.handleTaskCompletion(
            flowTask('every mon', { id: 'tv-inline:note.md:A', content: 'A', originalText: '- [x] A' }));
        const deletion = executor.fireAndDelete(
            flowTask('every tue', { id: 'tv-inline:note.md:B', content: 'B', originalText: '- [ ] B', statusChar: ' ' }));
        await Promise.all([completion, deletion]);

        // The completion's write, then the deletion's.
        expect(repository.applyToTask.mock.calls.map(c => (c[1] as TaskOp[]).at(-1)?.kind))
            .toEqual(['strip-flow', 'remove']);
    });
});
