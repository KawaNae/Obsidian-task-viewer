import { describe, it, expect, vi } from 'vitest';
import { FlowExecutor, type FirePlan } from '../../../src/services/flow/FlowExecutor';
import { parseFlowSegments, singleLineFlow } from '../../../src/services/lang/flow/FlowSegments';
import type { TaskOp } from '../../../src/services/persistence/TaskOps';
import type { FlowInstance } from '../../../src/services/persistence/FlowInstanceLines';
import { formatRow } from '../../../src/services/parsing/TaskLineFormat';
import { DEFAULT_SETTINGS, Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

function makeExecutor() {
    return new FlowExecutor({ getTask: vi.fn(() => undefined), getGenBlock: vi.fn(() => undefined) }, () => DEFAULT_SETTINGS);
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

/** The next instance a plan inserts (fails the test if it inserts none). */
function instanceOf(ops: readonly TaskOp[]): FlowInstance {
    const op = ops.find(o => o.kind === 'insert-instance');
    if (op?.kind !== 'insert-instance') throw new Error('no next instance');
    return op.instance;
}

describe('FlowExecutor.planTask: what a completion fires', () => {
    it('fires repeat: inserts the next instance, then strips the command', () => {
        const task = flowTask('every mon');
        const ops = opsOf(planOf(task));

        // Order: insert BEFORE strip, as the ops of the one write.
        expect(ops.map(o => o.kind)).toEqual(['insert-instance', 'strip-flow']);
        const { head, flowLines } = instanceOf(ops);
        expect(head).toContain('==> every mon');
        expect(flowLines).toEqual([]);
        // The strip rewrites the fired row to itself without its command.
        expect(ops[1]).toEqual({ kind: 'strip-flow', text: formatRow({ ...task, flow: undefined }).trim() });
    });

    it('fires a multi-line flow: child segments travel as flowLines, telomere decremented', () => {
        const raws = ['every mon', 'setDue(start + 3d)', 'x3'];
        const { program, diagnostics } = parseFlowSegments(raws);
        const task = flowTask('every mon', {
            flow: { raw: raws[0], childSegments: raws.slice(1).map((raw, i) => ({ raw, bodyLine: i + 1 })), program, diagnostics },
        });
        const ops = opsOf(planOf(task));

        const { head: line, flowLines } = instanceOf(ops);
        expect(line).toContain('==> every mon');
        expect(line).not.toContain('setDue');
        expect(flowLines).toEqual(['setDue(start + 3d)', 'x2']);
        expect(ops.filter(o => o.kind === 'strip-flow')).toHaveLength(1);
    });

    it('carries the row with move([[#heading]]), after the next instance, in the completing write, to the side the settings say', () => {
        const task = flowTask('every mon move([[#Done]])');
        const ops = opsOf(makeExecutor().planTask(task, () => undefined, ['## Done']));

        expect(ops.map(o => o.kind)).toEqual(['insert-instance', 'move']);
        expect(ops[1]).toEqual({ kind: 'move', text: '- [x] Test task @2026-06-29', to: { heading: 'Done', side: 'head' } });

        const atEnd = new FlowExecutor(
            { getTask: vi.fn(), getGenBlock: vi.fn() },
            () => ({ ...DEFAULT_SETTINGS, sectionSide: 'end' }),
        );
        expect(opsOf(atEnd.planTask(task, () => undefined, ['## Done']))[1]).toMatchObject({ to: { heading: 'Done', side: 'end' } });
    });

    it('fires nothing for a command whose move names no heading of the note: the command does not read', () => {
        for (const command of ['every mon move([[Archive]])', 'move([[Other]])', 'move()', 'every mon nochildren']) {
            expect(planOf(flowTask(command)).kind, command).toBe('none');
        }
    });

    it('fails the fire whole on a move to a heading that is not in the note', () => {
        const plan = makeExecutor().planTask(flowTask('every mon move([[#Done]])'), () => undefined, ['## Other']);

        expect(plan.kind === 'failed' && plan.error.code).toBe('eval.move-no-heading');
    });

    it('consumes without generating when until has expired', () => {
        expect(opsOf(planOf(flowTask('every mon until(2026-06-30)'))).map(o => o.kind)).toEqual(['strip-flow']);
    });

    it('leaves the command intact on runtime eval failure', () => {
        // `end` is unset on the task → EvalError at fire time
        expect(planOf(flowTask('every mon setDue(end + 1d)')).kind).toBe('failed');
    });

    it('decrements the telomere in the generated line', () => {
        expect(instanceOf(opsOf(planOf(flowTask('at(today + 1d) x3')))).head).toContain('==> at(today + 1d) x2');
    });

    it('x1: generated line carries no command', () => {
        expect(instanceOf(opsOf(planOf(flowTask('at(today + 1d) x1')))).head).not.toContain('==>');
    });
});

describe('planDeletion: what a delete with its fire writes', () => {
    // 削除は「コマンドを消費するもう一つの道」。行ごと消えるので strip の
    // 出番はなく、生成だけを先に済ませてから消す。書くのは操作の層
    // （Operations.deleteTask、DeleteWithFire.vault.test）。

    /** The ops of a plan that deletes (fails the test otherwise). */
    function deletes(task: Task): TaskOp[] {
        const plan = makeExecutor().planDeletion(task);
        if (plan.kind !== 'deletes') throw new Error(`the plan is ${plan.kind}`);
        return plan.ops;
    }

    it('writes the next instance and takes the original away, as the ops of one write', () => {
        // 挿入と削除を分けると、2本目が originalText で行を探し直すことになる。
        // 次回分は元の行と同じ本文になりうるので、その探索は当てにできない。
        expect(deletes(flowTask('every mon', { statusChar: ' ' }))).toEqual([
            { kind: 'insert-instance', instance: expect.objectContaining({ children: [] }) },
            { kind: 'remove' },
        ]);
    });

    it('fires an unchecked task: deletion is not a completion', () => {
        expect(deletes(flowTask('every mon', { statusChar: ' ' })).map(o => o.kind)).toEqual(['insert-instance', 'remove']);
    });

    it('does not move, whatever the move names: a delete was not a request to keep a copy', () => {
        for (const move of ['move([[#Nope]])', 'move([[#Done]])']) {
            expect(deletes(flowTask(`every mon ${move}`, { statusChar: ' ' })).map(o => o.kind)).toEqual(['insert-instance', 'remove']);
        }
    });

    it('deletes without generating when until has expired', () => {
        // 書くものが無いだけで、消す1本は同じ書き込みで出る。
        expect(deletes(flowTask('every mon until(2026-06-30)', { statusChar: ' ' }))).toEqual([{ kind: 'remove' }]);
    });

    it('names the blocks it read, for the write to find still reading so', () => {
        const body = ['- [ ] 週報 @${start}'];
        const executor = new FlowExecutor(
            { getTask: vi.fn(), getGenBlock: vi.fn((_file: string, name: string) => ({ name, body, openLine: 5, closeLine: 7 })) },
            () => DEFAULT_SETTINGS,
        );

        const plan = executor.planDeletion(flowTask('every mon use("w")', { statusChar: ' ' }));

        expect(plan).toMatchObject({ kind: 'deletes', blocks: [{ name: 'w', body }] });
    });

    it('fails when the fire cannot be planned, which stops the delete', () => {
        // 発火できないコマンドは行の上に残っており、その行が消える寸前だった。
        // ここで消すと、残そうとしたものをちょうど失う。
        const plan = makeExecutor().planDeletion(flowTask('every mon setDue(end + 1d)', { statusChar: ' ' }));

        expect(plan.kind).toBe('failed');
    });
});
