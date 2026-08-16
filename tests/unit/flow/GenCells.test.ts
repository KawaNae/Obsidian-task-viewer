import { describe, it, expect, vi } from 'vitest';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { parseFlowSegments } from '../../../src/services/flow/FlowSegments';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import type { GenBlock } from '../../../src/services/parsing/gen/GenBlockCollector';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { DEFAULT_SETTINGS, type Task } from '../../../src/types';

/**
 * The state a chain carries between its generations.
 *
 * Declared on the flow line, written by the block, printed back by the fire.
 * What these pin is the round trip: a value that leaves as text has to come
 * back as the same value, generation after generation, or a counter drifts and
 * the command it lives in stops being readable.
 */

const FILE = 'note.md';

function makeRepository() {
    return {
        insertRecurrenceForTask: vi.fn().mockResolvedValue(undefined),
        insertGeneratedInstance: vi.fn().mockResolvedValue(undefined),
        appendTaskWithChildren: vi.fn().mockResolvedValue(undefined),
        updateTaskInFile: vi.fn().mockResolvedValue(undefined),
        stripFlow: vi.fn().mockResolvedValue(undefined),
        deleteTaskFromFile: vi.fn().mockResolvedValue(undefined),
    };
}

const app = { vault: { getAbstractFileByPath: () => null } };

function block(name: string, body: string[]): GenBlock {
    return { name, body, openLine: 10, closeLine: 10 + body.length + 1 };
}

function makeExecutor(repository: ReturnType<typeof makeRepository>, blocks: Record<string, GenBlock>) {
    const taskIndex = {
        waitForScan: vi.fn().mockResolvedValue(undefined),
        resolveTask: vi.fn((t: Task) => t),
        requestScan: vi.fn().mockResolvedValue(undefined),
        notifyImmediate: vi.fn(),
        getGenBlock: vi.fn((_file: string, name: string) => blocks[name]),
    };
    return new FlowExecutor(
        repository as unknown as TaskRepository,
        taskIndex as unknown as TaskIndex,
        app as never,
        () => DEFAULT_SETTINGS
    );
}

async function flush() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

interface Written {
    parentLine: string;
    flowLines: string[];
    children: { depth: number; body: string }[];
    fired: boolean;
}

/**
 * Complete the task written on `line` and hand back what was written for the
 * next one.
 *
 * The line is read with the real parser rather than assembled by hand, so a
 * generation feeds the next one the way the file does: the command travels as
 * text and has to survive being read back.
 */
async function fire(line: string, blocks: Record<string, GenBlock>): Promise<Written> {
    const repository = makeRepository();
    const task = TaskParser.parse(line, FILE, 0);
    expect(task, `the line has to read back as a task: ${line}`).not.toBeNull();
    await makeExecutor(repository, blocks).handleTaskCompletion({ ...task!, statusChar: 'x' });
    await flush();

    const call = repository.insertGeneratedInstance.mock.calls[0];
    return call
        ? { parentLine: call[1], flowLines: call[2], children: call[3], fired: true }
        : { parentLine: '', flowLines: [], children: [], fired: false };
}

const COUNTER = { 週報: block('週報', ['- [ ] 週報 第${state.n = state.n + 1}回 @${start}']) };

describe('a cell travels from one generation to the next', () => {
    it('prints what the block wrote, not what the line started from', async () => {
        const written = await fire('- [x] 週報 第3回 @2026-08-17 ==> every mon state(n: 3) use("週報")', COUNTER);
        expect(written.parentLine).toBe(
            '- [ ] 週報 第4回 @2026-08-24 ==> every mon state(n: 4) use("週報")');
    });

    it('keeps counting over three generations', async () => {
        // 1 世代なら値の受け渡しが偶然合うこともある。3 世代続けて初めて、
        // 印字と解析が往復していることが言える。
        const lines: string[] = ['- [x] 週報 第3回 @2026-08-17 ==> every mon state(n: 3) use("週報")'];
        for (let i = 0; i < 3; i++) {
            const written = await fire(lines[i].replace('- [ ] ', '- [x] '), COUNTER);
            expect(written.fired).toBe(true);
            lines.push(written.parentLine);
        }
        expect(lines.slice(1)).toEqual([
            '- [ ] 週報 第4回 @2026-08-24 ==> every mon state(n: 4) use("週報")',
            '- [ ] 週報 第5回 @2026-08-31 ==> every mon state(n: 5) use("週報")',
            '- [ ] 週報 第6回 @2026-09-07 ==> every mon state(n: 6) use("週報")',
        ]);
    });

    it('writes a command of one line when a cell holds several', async () => {
        // 発火が書いたコマンドは次のスキャンが読めなければならない。生の
        // 改行を印字すると 2 行になり、鎖はそこで止まって 2 行目が素の
        // テキストとして残る（tv-xparse が PR #61 で見つけた形）。
        const written = await fire(
            '- [x] 記録 @2026-08-17 ==> every mon state(prev: "") use("記録")',
            {
                記録: block('記録', [
                    '<js',
                    'state.prev = ["- [ ] a", "- [ ] b"].join("\\n")',
                    '/js>',
                    '- [ ] 記録 @${start}',
                ]),
            });
        expect(written.fired).toBe(true);
        expect(written.parentLine.split('\n')).toHaveLength(1);
        expect(written.parentLine).toContain('state(prev: "- [ ] a\\n- [ ] b")');

        // 書いた行がそのまま読み戻せること。値も往復する。
        const back = TaskParser.parse(written.parentLine, FILE, 0);
        expect(back!.flow!.diagnostics).toEqual([]);
        expect(back!.flow!.program!.cells!.entries[0].value)
            .toEqual({ type: 'string', value: '- [ ] a\n- [ ] b' });
    });

    it('writes one line when the value came from a template written over two', async () => {
        // join とは別の入口。エスケープを 1 つも書かずに改行が値へ入る形で、
        // 通る関数は同じでもピンの言葉としては別のもの。
        const written = await fire(
            '- [x] 記録 @2026-08-17 ==> every mon state(prev: "") use("記録")',
            {
                記録: block('記録', [
                    '<js',
                    'state.prev = `one',
                    'two`',
                    '/js>',
                    '- [ ] 記録 @${start}',
                ]),
            });
        expect(written.fired).toBe(true);
        expect(written.parentLine.split('\n')).toHaveLength(1);
        expect(TaskParser.parse(written.parentLine, FILE, 0)!.flow!.program!.cells!.entries[0].value)
            .toEqual({ type: 'string', value: 'one\ntwo' });
    });

    it('carries a cell no block ever reads', async () => {
        // use() の無いコマンドは評価する物を持たない。宣言された値がその
        // まま次インスタンスへ運ばれる。
        const repository = makeRepository();
        const task = TaskParser.parse('- [x] 週報 @2026-08-17 ==> every mon state(n: 3)', FILE, 0)!;
        await makeExecutor(repository, {}).handleTaskCompletion({ ...task, statusChar: 'x' });
        await flush();

        const [newTask] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(newTask.flow.raw).toBe('every mon state(n: 3)');
    });

    it('keeps a cell on the line it was written on', async () => {
        // 行割りは span から決まる。子行に書いた let は子行に残る。
        const raws = ['every mon', 'state(n: 3) use("週報")'];
        const { program, diagnostics } = parseFlowSegments(raws);
        expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);

        const repository = makeRepository();
        const task = TaskParser.parse('- [x] 週報 第3回 @2026-08-17', FILE, 0)!;
        await makeExecutor(repository, COUNTER).handleTaskCompletion({
            ...task,
            statusChar: 'x',
            flow: {
                raw: raws[0],
                childSegments: [{ raw: raws[1], bodyLine: 1 }],
                program,
                diagnostics,
            },
        });
        await flush();

        const [, parentLine, flowLines] = repository.insertGeneratedInstance.mock.calls[0];
        expect(parentLine).toContain('==> every mon');
        expect(parentLine).not.toContain('state(');
        expect(flowLines).toEqual(['state(n: 4) use("週報")']);
    });
});

describe('the state ends with the command', () => {
    it('gives the last instance its body and no cell', async () => {
        // x1 の発火でもブロックは評価され、本文は書かれる。消えるのは状態
        // だけ — コマンドの無い行にセルの置き場所は無い。
        const written = await fire(
            '- [x] 週報 第3回 @2026-08-17 ==> every mon x1 state(n: 3) use("週報")', COUNTER);
        expect(written.parentLine).toBe('- [ ] 週報 第4回 @2026-08-24');
        expect(written.flowLines).toEqual([]);
    });
});

describe('a value that cannot be written back stops the fire', () => {
    const refuses = async (body: string[]) => {
        const repository = makeRepository();
        const task = TaskParser.parse(
            '- [x] 週報 第3回 @2026-08-17 ==> every mon state(n: 3) use("週報")', FILE, 0)!;
        await makeExecutor(repository, { 週報: block('週報', body) })
            .handleTaskCompletion({ ...task, statusChar: 'x' });
        await flush();

        // 2 相のまま: 何も書かれず、コマンドも消費されない。
        expect(repository.insertGeneratedInstance).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
    };

    it('when the block is written to put a list in a cell', async () => {
        // ここは静的検査（type.cell-not-storable）で止まる。ブロックが
        // 壊れている発火は評価にも入らない。
        await refuses(['<js', 'state.n = [1, 2]', '/js>', '- [ ] 週報 @${start}']);
    });

    it('when the type went unknown on the way and a list arrived anyway', async () => {
        // 静的には決まらない形。1 本目の代入で型が unknown に広がるので
        // 2 本目は何も言えず、書き戻しの直前の検査だけが残る関門になる。
        await refuses(['<js', 'state.n = "text"', 'state.n = [1, 2]', '/js>', '- [ ] 週報 @${start}']);
    });
});
