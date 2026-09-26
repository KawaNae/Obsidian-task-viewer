import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice, setMockLocale } from 'obsidian';
import { initI18n } from '../../../src/i18n';
import { FlowExecutor, type FirePlan } from '../../../src/services/flow/FlowExecutor';
import { parseFlowSegments, singleLineFlow } from '../../../src/services/flow/FlowSegments';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import type { TaskOp } from '../../../src/services/persistence/TaskOps';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS, Task } from '../../../src/types';
import type { WriteOutcome } from '../../../src/utils/FileLines';
import { makeTask } from '../helpers/makeTask';

function makeRepository() {
    return {
        applyToTask: vi.fn().mockResolvedValue({ written: true, refused: null, made: [] }),
    };
}

const app = { vault: { getAbstractFileByPath: () => null } };

function makeExecutor(repository: ReturnType<typeof makeRepository> = makeRepository()) {
    const taskIndex = { getTask: vi.fn(() => undefined), getGenBlock: vi.fn(() => undefined) };
    return new FlowExecutor(
        repository as unknown as TaskRepository,
        taskIndex as unknown as TaskIndex,
        app as never,
        () => DEFAULT_SETTINGS
    );
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

/** The fire of a completed row read as `task`, with no blocks. */
function planOf(task: Task): FirePlan {
    return makeExecutor().planTask(task, () => undefined, []);
}

/** The ops of a plan that fires in the completing write (fails the test otherwise). */
function opsOf(plan: FirePlan): TaskOp[] {
    if (plan.kind !== 'fires') throw new Error(`the plan is ${plan.kind}`);
    return plan.ops;
}

/** The recurrence a plan inserts (fails the test if it inserts none). */
function recurrenceOf(ops: readonly TaskOp[]): { content: string; flowLines: string[] } {
    const op = ops.find(o => o.kind === 'insert-instance');
    if (op?.kind !== 'insert-instance' || op.insert.kind !== 'recurrence') throw new Error('no recurrence');
    return op.insert;
}

describe('FlowExecutor.planTask: what a completion fires', () => {
    it('fires repeat: inserts the next instance, then strips the command', () => {
        const task = flowTask('every mon');
        const ops = opsOf(planOf(task));

        // Order: insert BEFORE strip, as the ops of the one write.
        expect(ops.map(o => o.kind)).toEqual(['insert-instance', 'strip-flow']);
        const { content, flowLines } = recurrenceOf(ops);
        expect(content).toContain('==> every mon');
        expect(flowLines).toEqual([]);
        // The strip rewrites the fired row to itself without its command.
        expect(ops[1]).toEqual({ kind: 'strip-flow', text: TaskParser.format({ ...task, flow: undefined }).trim() });
    });

    it('fires a multi-line flow: child segments travel as flowLines, telomere decremented', () => {
        const raws = ['every mon', 'setDue(start + 3d)', 'x3'];
        const { program, diagnostics } = parseFlowSegments(raws);
        const task = flowTask('every mon', {
            flow: { raw: raws[0], childSegments: raws.slice(1).map((raw, i) => ({ raw, bodyLine: i + 1 })), program, diagnostics },
        });
        const ops = opsOf(planOf(task));

        const { content: line, flowLines } = recurrenceOf(ops);
        expect(line).toContain('==> every mon');
        expect(line).not.toContain('setDue');
        expect(flowLines).toEqual(['setDue(start + 3d)', 'x2']);
        expect(ops.filter(o => o.kind === 'strip-flow')).toHaveLength(1);
    });

    it('carries the row with move(), after the next instance, in the completing write', () => {
        const ops = opsOf(planOf(flowTask('every mon move()')));

        expect(ops.map(o => o.kind)).toEqual(['insert-instance', 'move']);
        expect(ops[1]).toEqual({ kind: 'move', text: '- [x] Test task @2026-06-29', to: { kind: 'end' } });
    });

    it('fails a move that names another note: retired, nothing of the fire is written', () => {
        const plan = planOf(flowTask('every mon move([[Archive]])'));

        expect(plan.kind === 'failed' && plan.error.code).toBe('eval.move-retired');
    });

    it('consumes without generating when until has expired', () => {
        expect(opsOf(planOf(flowTask('every mon until(2026-06-30)'))).map(o => o.kind)).toEqual(['strip-flow']);
    });

    it('leaves the command intact on runtime eval failure', () => {
        // `end` is unset on the task → EvalError at fire time
        expect(planOf(flowTask('every mon setDue(end + 1d)')).kind).toBe('failed');
    });

    it('decrements the telomere in the generated line', () => {
        expect(recurrenceOf(opsOf(planOf(flowTask('at(today + 1d) x3')))).content).toContain('==> at(today + 1d) x2');
    });

    it('x1: generated line carries no command', () => {
        expect(recurrenceOf(opsOf(planOf(flowTask('at(today + 1d) x1')))).content).not.toContain('==>');
    });
});

describe('a fire that does not happen says so', () => {
    // 非発火・非消費は設計どおりだが、外から見えるのは「チェックしても何も
    // 起きないチェックボックス」。ログしか残らないと、タスクを触っている人
    // には何も届かない。
    beforeEach(() => {
        Notice.messages.length = 0;
    });

    /**
     * Complete a row whose command fails, as a write does: the fire planned
     * inside the write, and what it owes once the write landed.
     */
    async function complete(executor: FlowExecutor, command: string, file = 'notes/週報.md'): Promise<void> {
        const fire = executor.fireOp(file);
        fire.op.plan([`- [x] Test task @2026-06-29 ==> ${command}`], 0);
        executor.reportUnfired(fire);
    }

    it('shows what stopped it, and which file it was in', async () => {
        await complete(makeExecutor(), 'at(end + 1d)');

        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain("Property 'end' is not set on this task");
        expect(Notice.messages[0]).toContain('週報');
    });

    it('says it once while the same task keeps failing the same way', async () => {
        // 直すために付けたり外したりする間、同じ文言が積み上がるとファイル
        // 自体が見えなくなる。
        const executor = makeExecutor();

        await complete(executor, 'at(end + 1d)');
        await complete(executor, 'at(end + 1d)');

        expect(Notice.messages).toHaveLength(1);
    });

    it('says the next failure, since it is a different thing to fix', async () => {
        const executor = makeExecutor();

        await complete(executor, 'at(end + 1d)');
        // 同じタスクの別の失敗。窓は「同じ失敗」に効くのであって、
        // 「そのタスクを黙らせる」ためのものではない。
        await complete(executor, 'at(due + 1d)');

        expect(Notice.messages).toHaveLength(2);
        expect(Notice.messages[1]).toContain("Property 'due' is not set on this task");
    });

    it('says it in the reader language', async () => {
        // 理由の英文はエンジンが投げた場所で書かれている。通知はそれをそのまま
        // 出すのではなく code で引き直すので、日本語の vault では日本語になる。
        setMockLocale('ja');
        initI18n();
        try {
            await complete(makeExecutor(), 'at(end + 1d)');
        } finally {
            setMockLocale('en');
            initI18n();
        }

        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain("このタスクにプロパティ 'end' は設定されていません");
    });

    it('stays quiet when the fire went through', async () => {
        await complete(makeExecutor(), 'at(today + 1d)');

        expect(Notice.messages).toEqual([]);
    });
});

describe('fireAndDelete', () => {
    // 削除は「コマンドを消費するもう一つの道」。行ごと消えるので strip の
    // 出番はなく、生成だけを先に済ませてから消す。
    beforeEach(() => {
        Notice.messages.length = 0;
    });

    /** The ops of each one-write call that takes the row away: the deletion fires. */
    function deletionsOf(repository: ReturnType<typeof makeRepository>): TaskOp[][] {
        return repository.applyToTask.mock.calls
            .map(c => c[1] as TaskOp[])
            .filter(ops => ops.some(o => o.kind === 'remove'));
    }

    it('writes the next instance and takes the original away in one write', async () => {
        const repository = makeRepository();
        const task = flowTask('every mon', { statusChar: ' ' });

        await makeExecutor(repository).fireAndDelete(task);

        // 挿入と削除を分けると、2本目が originalText で行を探し直すことになる。
        // 次回分は元の行と同じ本文になりうるので、その探索は当てにできない。
        expect(repository.applyToTask).toHaveBeenCalledTimes(1);
        expect(repository.applyToTask).toHaveBeenCalledWith(plannedOn(task, { commands: true, subtree: true }), [
            { kind: 'insert-instance', insert: expect.objectContaining({ kind: 'recurrence' }) },
            { kind: 'remove' },
        ]);
    });

    it('fires an unchecked task: deletion is not a completion', async () => {
        const repository = makeRepository();

        await makeExecutor(repository).fireAndDelete(flowTask('every mon', { statusChar: ' ' }));

        expect(deletionsOf(repository).map(ops => ops.map(o => o.kind))).toEqual([['insert-instance', 'remove']]);
    });

    it('does not move, whatever the move names: a delete was not a request to keep a copy', async () => {
        for (const move of ['move()', 'move([[#Nope]])', 'move([[Archive]])']) {
            const repository = makeRepository();

            expect(await makeExecutor(repository).fireAndDelete(flowTask(`every mon ${move}`, { statusChar: ' ' }))).toBe(true);

            expect(deletionsOf(repository).map(ops => ops.map(o => o.kind))).toEqual([['insert-instance', 'remove']]);
        }
    });

    it('deletes without generating when until has expired', async () => {
        const repository = makeRepository();

        await makeExecutor(repository).fireAndDelete(flowTask('every mon until(2026-06-30)', { statusChar: ' ' }));

        // 書くものが無いだけで、消す1本は同じ呼び出しで出る。
        expect(deletionsOf(repository)).toEqual([[{ kind: 'remove' }]]);
    });

    it('keeps the task when the fire fails, and says why', async () => {
        // 発火できないコマンドは行の上に残っており、その行が消える寸前だった。
        // ここで消すと、残そうとしたものをちょうど失う。
        const repository = makeRepository();

        const removed = await makeExecutor(repository).fireAndDelete(flowTask('every mon setDue(end + 1d)', { statusChar: ' ' }));

        expect(removed).toBe(false);
        expect(repository.applyToTask).not.toHaveBeenCalled();
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain('the task was not deleted');
    });

    it('reports the task gone when it deleted it', async () => {
        // 呼んだ側はこの答えでパネルを閉じるかを決める。書き込んだかどうかでは
        // なく、タスクが消えたかどうかを聞いている。
        const executor = makeExecutor();

        expect(await executor.fireAndDelete(flowTask('every mon', { statusChar: ' ' }))).toBe(true);
        expect(await executor.fireAndDelete(flowTask('every mon until(2026-06-30)', { statusChar: ' ' }))).toBe(true);
    });

    it('reports the task still there when the write found no line', async () => {
        // 行が解決できなければ次回分も書かれていない。タスクは消えていないので
        // 答えは no。ユーザーへの通知は書き込みを拒否した側（TaskIndex.reportRefusal）
        // が一度だけ出すので、ここでは出さない。
        const repository = makeRepository();
        repository.applyToTask.mockResolvedValue({
            written: false, refused: { file: 'note.md', reason: { kind: 'gone' }, subject: 'Test task' }, made: [],
        });

        expect(await makeExecutor(repository).fireAndDelete(flowTask('every mon', { statusChar: ' ' }))).toBe(false);
        expect(Notice.messages).toHaveLength(0);
    });

    it('answers, rather than throws, when a write throws', async () => {
        // 待ち手を残したまま返らないと、呼んだメニューがそのまま固まる。
        const repository = makeRepository();
        repository.applyToTask.mockRejectedValueOnce(new Error('disk on fire'));

        expect(await makeExecutor(repository).fireAndDelete(flowTask('every mon', { statusChar: ' ' }))).toBe(false);
    });
});
