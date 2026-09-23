import { describe, it, expect, afterEach, vi } from 'vitest';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { TaskLineClassifier } from '../../../src/services/parsing/utils/TaskLineClassifier';
import type { Task } from '../../../src/types';

/**
 * A task with no content is `- [ ] `: Obsidian reads a checkbox as a task
 * only with a space or a tab after its `]`, so `- [ ]` is no task. Every
 * route by which the plugin writes such a line keeps that gap. Each case
 * writes, then reads the written bytes back: the line itself, the line as a
 * task line with a gap after `]`, and the index holding the row.
 */
const FILE = 'note.md';
const LF = String.fromCharCode(10);

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(lines: string[]): Promise<{ session: VaultSession; contents: Map<string, string> }> {
    const contents = new Map([[FILE, lines.join(LF)]]);
    live = vaultSession(contents);
    await live.scanAll();
    return { session: live, contents };
}

function written(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split(LF);
}

function tasksOf(session: VaultSession): Task[] {
    return session.index.getTasks().filter(t => t.file === FILE);
}

function onlyTask(session: VaultSession, pick: (t: Task) => boolean): Task {
    const found = tasksOf(session).filter(pick);
    expect(found).toHaveLength(1);
    return found[0];
}

/** The line reads as a task line, with a space or a tab right after `]`. */
function expectBareTaskLine(line: string): void {
    expect(TaskLineClassifier.isTaskLine(line)).toBe(true);
    const classified = TaskLineClassifier.classify(line)!;
    // `rawContent` drops the one gap after `]`; `suffix` is `]` and all after it.
    expect(classified.suffix).toMatch(/^\][ \t]/);
    expect(classified.rawContent).toBe('');
}

/** The row the index read on `line` (0-based), with no content. */
function expectIndexedBare(session: VaultSession, line: number, statusChar: string): Task {
    const task = onlyTask(session, t => t.line === line);
    expect(task.content).toBe('');
    expect(task.statusChar).toBe(statusChar);
    return task;
}

async function flowSettled(session: VaultSession): Promise<void> {
    const executor = (session.index as unknown as { commandExecutor: { isProcessing: boolean; taskQueue: unknown[] } }).commandExecutor;
    await vi.waitFor(() => { expect(executor.isProcessing).toBe(false); expect(executor.taskQueue).toHaveLength(0); });
    await session.settle(FILE);
}

describe('1. an update of status or content', () => {
    it('checks `- [ ] ` into `- [x] `', async () => {
        const { session, contents } = await open(['# note', '- [ ] ', '- [ ] 名前あり', '']);
        const task = expectIndexedBare(session, 1, ' ');

        expect(await session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
        await session.settle(FILE);

        const lines = written(contents);
        expect(lines[1]).toBe('- [x] ');
        expectBareTaskLine(lines[1]);
        expectIndexedBare(session, 1, 'x');
    });

    it('writes `- [ ] ` when the content is cleared', async () => {
        const { session, contents } = await open(['# note', '- [ ] 消す', '- [ ] 残す', '']);
        const task = onlyTask(session, t => t.content === '消す');

        expect(await session.index.updateTask(task.id, { content: '' })).toBe(true);
        await session.settle(FILE);

        const lines = written(contents);
        expect(lines[1]).toBe('- [ ] ');
        expectBareTaskLine(lines[1]);
        expectIndexedBare(session, 1, ' ');
    });
});

describe('2. a child inserted with no content', () => {
    it('writes the child as `\\t- [ ] ` under a tab-indented parent', async () => {
        const { session, contents } = await open(['# note', '- [ ] 親', '\t- [ ] 兄', '']);
        const parent = onlyTask(session, t => t.content === '親');

        // What TaskApi.insertChildTask sends for `content: ''`.
        expect(await session.index.insertChildTask(parent.id, '- [ ] ')).toBe(true);
        await session.settle(FILE);

        const lines = written(contents);
        expect(lines[2]).toBe('\t- [ ] ');
        expectBareTaskLine(lines[2]);
        expect(lines[3]).toBe('\t- [ ] 兄');
        expectIndexedBare(session, 2, ' ');
    });
});

describe('3. a strip-flow on a task with no content and no date', () => {
    it('leaves `- [x] ` where the command fired', async () => {
        const { session, contents } = await open(['# note', '- [ ] ', '\t- ==> every mon', '- [ ] 下', '']);
        const task = expectIndexedBare(session, 1, ' ');
        expect(task.flow).toBeDefined();

        expect(await session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
        await flowSettled(session);

        const lines = written(contents);
        // The next instance goes above with the command (its date is the
        // next Monday from today, so only its shape is pinned); the row that
        // fired keeps its place below, the command stripped from it.
        expect(lines[1]).toMatch(/^- \[ \] @\d{4}-\d{2}-\d{2}$/);
        expect(lines.slice(2)).toEqual(['\t- ==> every mon', '- [x] ', '- [ ] 下', '']);
        expectBareTaskLine(lines[3]);
        const row = expectIndexedBare(session, 3, 'x');
        expect(row.flow).toBeUndefined();
    });
});

describe('4. a generated child line with no content', () => {
    it('writes the child as `\\t- [ ] `', async () => {
        const { session, contents } = await open(['# note', '- [ ] 親 @2026-09-21', '\t- ==> every mon use("g")', '',
            '```tv-gen g', '- [ ] 親', '\t- [ ] ', '```', '']);
        const parent = onlyTask(session, t => t.content === '親');

        expect(await session.index.updateTask(parent.id, { statusChar: 'x' })).toBe(true);
        await flowSettled(session);

        const lines = written(contents);
        // The block's parent line carries no date, so the instance is written as the block says.
        expect(lines.slice(0, 5)).toEqual(['# note', '- [ ] 親', '\t- ==> every mon use("g")', '\t- [ ] ', '- [x] 親 @2026-09-21']);
        expectBareTaskLine(lines[3]);
        expectIndexedBare(session, 3, ' ');
    });
});

describe('5. a generated parent line with no content', () => {
    it('writes the parent with the gap after `]`', async () => {
        const { session, contents } = await open(['# note', '- [ ] 親 @2026-09-21', '\t- ==> every mon use("g")', '',
            '```tv-gen g', '- [ ] ', '\t- [ ] 子', '```', '']);
        const parent = onlyTask(session, t => t.content === '親');

        expect(await session.index.updateTask(parent.id, { statusChar: 'x' })).toBe(true);
        await flowSettled(session);

        const lines = written(contents);
        expect(lines.slice(0, 5)).toEqual(['# note', '- [ ] ', '\t- ==> every mon use("g")', '\t- [ ] 子', '- [x] 親 @2026-09-21']);
        expectBareTaskLine(lines[1]);
        const row = expectIndexedBare(session, 1, ' ');
        expect(row.flow).toBeDefined();
    });
});

describe('6. a copy of `- [ ] ^a`', () => {
    it('writes `- [ ] ` with no block id', async () => {
        const { session, contents } = await open(['# note', '- [ ] ^a', '- [ ] 下', '']);
        const task = expectIndexedBare(session, 1, ' ');
        expect(task.blockId).toBe('a');

        expect(await session.index.duplicateTask(task.id)).toBe(true);
        await session.settle(FILE);

        const lines = written(contents);
        expect(lines.slice(0, 4)).toEqual(['# note', '- [ ] ^a', '- [ ] ', '- [ ] 下']);
        expectBareTaskLine(lines[2]);
        const copy = expectIndexedBare(session, 2, ' ');
        expect(copy.blockId).toBeUndefined();
        expect(onlyTask(session, t => t.line === 1).blockId).toBe('a');
    });
});

describe('7. reading `- [ ] ^abc`', () => {
    it('reads a task with no content and the block id, and keeps both through a check', async () => {
        const { session, contents } = await open(['# note', '- [ ] ^abc', '']);
        const task = expectIndexedBare(session, 1, ' ');
        expect(task.blockId).toBe('abc');

        expect(await session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
        await session.settle(FILE);

        const line = written(contents)[1];
        expect(line).toMatch(/^- \[x\] +\^abc$/);
        const { text, blockId } = TaskLineClassifier.extractLineBlockId(line);
        expect(blockId).toBe('abc');
        expect(text).toBe('- [x] ');
        expectBareTaskLine(text);
        const again = expectIndexedBare(session, 1, 'x');
        expect(again.blockId).toBe('abc');
    });

    it('writes the checked line as `- [x] ^abc` byte for byte', async () => {
        const { session, contents } = await open(['# note', '- [ ] ^abc', '']);
        const task = expectIndexedBare(session, 1, ' ');
        expect(await session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
        await session.settle(FILE);
        expect(written(contents)[1]).toBe('- [x] ^abc');
    });
});
