import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { parseFlowSegments, singleLineFlow } from '../../../src/services/flow/FlowSegments';
import { collectGenBlocks } from '../../../src/services/parsing/gen/GenBlockCollector';
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

function makeExecutor(repository: ReturnType<typeof makeRepository>) {
    const taskIndex = {
        waitForScan: vi.fn().mockResolvedValue(undefined),
        resolveTask: vi.fn((t: Task) => t),
        requestScan: vi.fn().mockResolvedValue(undefined),
        notifyImmediate: vi.fn(),
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

describe('a use() flow today: the block is named but never read', () => {
    it('fires down the recurrence path, not the generated one', async () => {
        // FLIPS: the wiring routes a resolvable use() to insertGeneratedInstance.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(1);
        expect(repository.insertGeneratedInstance).not.toHaveBeenCalled();
    });

    it('copies the live child lines it is meant to stop copying', async () => {
        // FLIPS: the block writes the children, so the live ones stay put.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        const [, , copyChildren] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(copyChildren).toBe(true);
    });

    it('carries the clause on to the next instance', async () => {
        // HOLDS: the generated line must keep naming its block, or the chain
        // generates once and then falls back to a plain recurrence.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(firedTask('every mon use("週報")'));
        await flush();

        const [, line] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(line).toContain('==> every mon use("週報")');
    });

    it('keeps the clause on the line the user wrote it on', async () => {
        // HOLDS: line-level canonical inheritance decides where a clause
        // lands, and use() is not exempt from it.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
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

        const [, line, , flowLines] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(line).not.toContain('use(');
        expect(flowLines).toEqual(['use("週報")']);
    });

    it('fires and consumes even when no block answers to the name', async () => {
        // FLIPS: a name that resolves to nothing must not fire and must not
        // consume — the command has to survive for the user to fix the name.
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(firedTask('every mon use("存在しない")'));
        await flush();

        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(1);
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
