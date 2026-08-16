import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { parseFlowSegments, singleLineFlow } from '../../../src/services/flow/FlowSegments';
import { collectGenBlocks, type GenBlock } from '../../../src/services/parsing/gen/GenBlockCollector';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';
import { TaskCloner, type GeneratedChild } from '../../../src/services/persistence/TaskCloner';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { DEFAULT_SETTINGS, type Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * The seam between a `use()` flow and the block that is meant to write its
 * next instance.
 *
 * Both ends of that seam exist: a flow command can name a block, a file's
 * blocks are collected and their literal lines read as a shape, and the write
 * layer can place a generated instance. Nothing joins them yet — the planner
 * never looks a name up, so a task carrying `use(...)` fires down the same
 * recurrence path it did before blocks existed.
 *
 * These tests pin that as it stands today. Half of them are expected to flip
 * when the wiring lands, and each says which way; the value is that the change
 * arrives as a diff in behaviour rather than as new tests appearing beside old
 * ones that quietly still pass.
 */

// ---------------------------------------------------------------------------
// The planner/executor seam
// ---------------------------------------------------------------------------

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

/** A block as the scan would have collected it, from its body lines. */
function block(name: string, body: string[]): GenBlock {
    return { name, body, openLine: 10, closeLine: 10 + body.length + 1 };
}

function makeExecutor(
    repository: ReturnType<typeof makeRepository>,
    blocks: Record<string, GenBlock> = {},
) {
    const taskIndex = {
        waitForScan: vi.fn().mockResolvedValue(undefined),
        resolveTask: vi.fn((t: Task) => t),
        requestScan: vi.fn().mockResolvedValue(undefined),
        notifyImmediate: vi.fn(),
        getGenBlock: vi.fn((_file: string, name: string) => blocks[name]),
    };
    const executor = new FlowExecutor(
        repository as unknown as TaskRepository,
        taskIndex as unknown as TaskIndex,
        app as never,
        () => DEFAULT_SETTINGS
    );
    return { executor, taskIndex };
}

function firedTask(src: string, overrides: Partial<Task> = {}): Task {
    return makeTask({
        statusChar: 'x',
        content: '週報 第3回',
        startDate: '2026-08-17',
        originalText: '- [x] 週報 第3回 @2026-08-17',
        flow: singleLineFlow(src),
        ...overrides,
    });
}

async function flush() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

const WEEKLY = block('週報', [
    '- [ ] 週報 第4回 @${start}',
    '\t- [ ] 資料集め',
    '\t\t- [ ] 先週分',
]);

describe('a use() flow writes what its block describes', () => {
    it('takes the generated path instead of the recurrence one', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, { 週報: WEEKLY });

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        expect(repository.insertGeneratedInstance).toHaveBeenCalledTimes(1);
        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
    });

    it('leaves the live child lines where they are', async () => {
        // Nothing in this path carries them: the block says what the next
        // instance holds, and the records stay with the instance that made
        // them. The recurrence path is what used to copy them.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, { 週報: WEEKLY });

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        const [, , , children] = repository.insertGeneratedInstance.mock.calls[0];
        expect(children).toEqual([
            { depth: 1, body: '- [ ] 資料集め' },
            { depth: 2, body: '- [ ] 先週分' },
        ]);
    });

    it('carries the clause on to the next instance', async () => {
        // The generated line must keep naming its block, or the chain
        // generates once and then falls back to a plain recurrence.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, { 週報: WEEKLY });

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        const [, parentLine] = repository.insertGeneratedInstance.mock.calls[0];
        expect(parentLine).toContain('==> every mon use("週報")');
    });

    it('fills the interpolation with the new instance\'s own date', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, { 週報: WEEKLY });

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        const [, parentLine] = repository.insertGeneratedInstance.mock.calls[0];
        expect(parentLine).toContain('@2026-08-24');
    });

    it('keeps the clause on the line the user wrote it on', async () => {
        // Line-level canonical inheritance decides where a clause lands, and
        // use() is not exempt from it.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, { 週報: WEEKLY });
        const raws = ['every mon', 'use("週報")'];
        const { program, diagnostics } = parseFlowSegments(raws);

        await executor.handleTaskCompletion(firedTask('every mon', {
            flow: {
                raw: raws[0],
                childSegments: [{ raw: raws[1], bodyLine: 1 }],
                program,
                diagnostics,
            },
        }));
        await flush();

        const [, parentLine, flowLines] = repository.insertGeneratedInstance.mock.calls[0];
        expect(parentLine).not.toContain('use(');
        expect(flowLines).toEqual(['use("週報")']);
    });

    it('builds the parent itself when the block writes only children', async () => {
        // One payload shape, so the write layer never learns that a block
        // can leave the parent out.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, {
            朝: block('朝', ['\t- [ ] ストレッチ']),
        });

        await executor.handleTaskCompletion(firedTask('every mon use("朝")'));
        await flush();

        const [, parentLine, , children] = repository.insertGeneratedInstance.mock.calls[0];
        expect(parentLine).toBe('- [ ] 週報 第3回 @2026-08-24 ==> every mon use("朝")');
        expect(children).toEqual([{ depth: 1, body: '- [ ] ストレッチ' }]);
    });

    it('gives the last instance its body and no command', async () => {
        // x1 ends the chain, and the clause is composed after the block has
        // run — the block still describes this instance, it simply has
        // nothing left to carry. What the command holds between generations
        // ends with it.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, { 週報: WEEKLY });

        await executor.handleTaskCompletion(firedTask('every mon x1 use("週報")'));
        await flush();

        const [, parentLine, flowLines, children] = repository.insertGeneratedInstance.mock.calls[0];
        expect(parentLine).not.toContain('==>');
        expect(flowLines).toEqual([]);
        expect(children).toEqual([
            { depth: 1, body: '- [ ] 資料集め' },
            { depth: 2, body: '- [ ] 先週分' },
        ]);
    });

    it('fires a block the static reading calls out of order', async () => {
        // A line that is only an interpolation is placed by its value, so a
        // parent written below one reads as out of order and renders fine.
        // The editor says so with a squiggle; refusing to fire would be the
        // harsher answer to the same observation.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, {
            週報: block('週報', ['\t${["- [ ] 資料集め"]}', '- [ ] 週報 @${start}']),
        });

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        const [, parentLine, , children] = repository.insertGeneratedInstance.mock.calls[0];
        expect(parentLine).toContain('- [ ] 週報 @2026-08-24');
        expect(children).toEqual([{ depth: 1, body: '- [ ] 資料集め' }]);
    });

    it('unchecks a parent line the block wrote as done', async () => {
        // Otherwise the instance is complete the moment it lands and fires
        // again on the next scan, for as long as the vault is open.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, {
            週報: block('週報', ['- [x] 週報 @${start}']),
        });

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        const [, parentLine] = repository.insertGeneratedInstance.mock.calls[0];
        expect(parentLine.startsWith('- [ ] ')).toBe(true);
    });
});

describe('a fire that cannot generate writes nothing and keeps its command', () => {
    const refuses = async (blocks: Record<string, GenBlock>, src = 'every mon use("週報")') => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, blocks);

        await executor.handleTaskCompletion(firedTask(src));
        await flush();

        expect(repository.insertGeneratedInstance).not.toHaveBeenCalled();
        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
    };

    it('when no block answers to the name', async () => {
        await refuses({});
    });

    it('when the block writes a flow command of its own', async () => {
        await refuses({ 週報: block('週報', ['- [ ] 週報 @${start} ==> every mon']) });
    });

    it('when the block writes a block id', async () => {
        await refuses({ 週報: block('週報', ['- [ ] 週報 @${start} ^weekly']) });
    });

    it('when a generated child writes a block id', async () => {
        await refuses({
            週報: block('週報', ['- [ ] 週報 @${start}', '\t- [ ] 資料 ^weekly-note']),
        });
    });

    it('when the block cannot describe one task', async () => {
        // The parse keeps the first line at depth 0 and drops the rest, so
        // the render never learns they existed. Firing would write an
        // instance missing lines nobody deleted.
        await refuses({ 週報: block('週報', ['- [ ] 一つ目', '- [ ] 二つ目']) });
    });

    it('when the js section fails while it runs', async () => {
        // Two-phase: the section runs before anything is written, so a
        // failure inside it leaves the page exactly as it was.
        await refuses({
            週報: block('週報', ['<js>', 'const n = 1 / 0', '</js>', '- [ ] 週報 @${start}']),
        });
    });

    it('when the js section runs past its budget', async () => {
        await refuses({
            週報: block('週報', ['<js>', 'let n = 0', 'while (true) { n = n + 1 }', '</js>', '- [ ] 週報 @${start}']),
        });
    });

    it('when an expression in the block fails', async () => {
        // `end` is unset on the task that fired.
        await refuses({ 週報: block('週報', ['- [ ] 週報 @${end}']) });
    });
});

describe('a fire that generates nothing still consumes its command', () => {
    it('does not hold the command hostage to a name it no longer needs', async () => {
        // until has passed, so there is no next instance to write and the
        // block is never consulted. Refusing here would leave expired
        // commands on the page for good.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository, {});

        await executor.handleTaskCompletion(
            firedTask('every mon until(2026-08-18) use("存在しない")'));
        await flush();

        expect(repository.insertGeneratedInstance).not.toHaveBeenCalled();
        expect(repository.stripFlow).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Block body → file, joined by hand
// ---------------------------------------------------------------------------

/**
 * What the wiring will do between the two ends, done here in the test: read a
 * file's blocks, read the named one's body as a shape, and hand that shape to
 * the write layer.
 *
 * Interpolation is deliberately absent — these bodies are literal, so a line
 * travels as written. That is what lets this pin the pass-through itself: a
 * depth and a text on one side, an indent and a line on the other, with no
 * transformation in between that either side could disagree about.
 */

const FILE = 'note.md';

function harness(initial: string) {
    let content = initial;
    const file = new TFile();
    const vaultApp = {
        vault: {
            getAbstractFileByPath: () => file,
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
        },
    } as any;
    return {
        cloner: new TaskCloner(vaultApp, new FileOperations(vaultApp)),
        lines: () => content.split('\n'),
    };
}

/** Read one named block of `lines` as a parent line and children. */
function shapeOf(lines: string[], name: string) {
    const block = collectGenBlocks(lines).blocks.get(name)!;
    const body = parseGenBody(block.body, block.openLine + 1);
    const children: GeneratedChild[] = body.children.map(c => ({ depth: c.depth, body: c.text }));
    return { parentLine: body.parent?.text ?? null, children, diagnostics: body.diagnostics };
}

const document = [
    '- [x] 週報 第3回 @2026-08-17 ==> every mon use("週報")',
    '\t- [x] ⏱️ 09:00-10:00',
    '',
    '```tv-gen 週報',
    '- [ ] 週報 第4回 @2026-08-24',
    '\t- [ ] 資料集め',
    '\t\t- [ ] 先週分',
    '\t- [ ] 下書き',
    '```',
];

const firedInFile = () => makeTask({
    file: FILE,
    line: 0,
    content: '週報 第3回',
    statusChar: 'x',
    startDate: '2026-08-17',
    originalText: document[0],
});

describe('a block body reaches the file unchanged', () => {
    it('places the block\'s shape above the task that fired', async () => {
        const h = harness(document.join('\n'));
        const { parentLine, children } = shapeOf(document, '週報');

        await h.cloner.insertGeneratedInstance(
            firedInFile(), parentLine!, ['every mon', 'use("週報")'], children
        );

        expect(h.lines().slice(0, 7)).toEqual([
            '- [ ] 週報 第4回 @2026-08-24',
            '\t- ==> every mon',
            '\t- ==> use("週報")',
            '\t- [ ] 資料集め',
            '\t\t- [ ] 先週分',
            '\t- [ ] 下書き',
            document[0],
        ]);
    });

    it('leaves the record the fired instance kept where it is', async () => {
        // The live child lines are that instance's own history. Nothing in
        // this path touches them — the block decides what the next instance
        // holds, which is the whole point of the redesign.
        const h = harness(document.join('\n'));
        const { parentLine, children } = shapeOf(document, '週報');

        await h.cloner.insertGeneratedInstance(firedInFile(), parentLine!, [], children);

        const written = h.lines();
        expect(written[written.indexOf(document[0]) + 1]).toBe('\t- [x] ⏱️ 09:00-10:00');
    });

    it('reads an all-indented block as children with no parent', () => {
        const childrenOnly = [
            '```tv-gen 朝',
            '\t- [ ] ストレッチ',
            '\t- [ ] 水を飲む',
            '```',
        ];
        const { parentLine, children, diagnostics } = shapeOf(childrenOnly, '朝');

        expect(parentLine).toBeNull();
        expect(children).toEqual([
            { depth: 1, body: '- [ ] ストレッチ' },
            { depth: 1, body: '- [ ] 水を飲む' },
        ]);
        expect(diagnostics).toEqual([]);
    });

    it('takes the indent unit from the file, not from the block', async () => {
        const spaced = [
            '- [x] 週報 第3回 @2026-08-17 ==> every mon use("週報")',
            '    - [x] ⏱️ 09:00-10:00',
            '',
            '```tv-gen 週報',
            '- [ ] 週報 第4回 @2026-08-24',
            '\t- [ ] 資料集め',
            '```',
        ];
        const h = harness(spaced.join('\n'));
        const { parentLine, children } = shapeOf(spaced, '週報');

        await h.cloner.insertGeneratedInstance(
            makeTask({
                file: FILE, line: 0, content: '週報 第3回', statusChar: 'x',
                startDate: '2026-08-17', originalText: spaced[0],
            }),
            parentLine!, [], children
        );

        expect(h.lines()[1]).toBe('    - [ ] 資料集め');
    });
});
