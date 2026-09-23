import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * A task's subtree goes on past a blank line inside it (論点4), for the
 * parser and for every write alike.
 *
 * The subtree used to stop at the first blank line. A deeper line below one
 * was the parser's orphan and every write's too: a delete left it behind, a
 * move within the file left it where it was while the row went to the end
 * (C-3), a move to another file archived the half above the blank line.
 */

const FILE = 'note.md';
const ARCHIVE = 'archive.md';

let live: VaultSession | undefined;

beforeEach(() => {
    Notice.messages.length = 0;
});

afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(files: Record<string, string[]>): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const contents = new Map(Object.entries(files).map(([path, lines]) => [path, lines.join('\n')]));
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

async function flowSettled(session: VaultSession, ...paths: string[]): Promise<void> {
    const executor = (session.index as unknown as { commandExecutor: { isProcessing: boolean; taskQueue: unknown[] } }).commandExecutor;
    await vi.waitFor(() => {
        expect(executor.isProcessing).toBe(false);
        expect(executor.taskQueue).toHaveLength(0);
    });
    for (const path of [FILE, ...paths]) await session.settle(path);
}

function idOf(session: VaultSession, content: string, file = FILE): string {
    const found = session.index.getTasks().filter(task => task.file === file && task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

async function complete(session: VaultSession, content: string, ...paths: string[]): Promise<void> {
    expect(await session.index.updateTask(idOf(session, content), { statusChar: 'x' })).toBe(true);
    await flowSettled(session, ...paths);
}

describe('a subtree with a blank line inside it', () => {
    it('moves whole within the file, every row keeping its ID (C-3)', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] 対象 @2026-09-21 ==> move([[note]])', '\t- [ ] 子1', '', '\t- [ ] 子2', '- [ ] 下', ''],
        });
        const held = { target: idOf(session, '対象'), first: idOf(session, '子1'), second: idOf(session, '子2') };

        await complete(session, '対象');

        expect(contents.get(FILE)).toBe(
            ['# note', '- [ ] 下', '- [x] 対象 @2026-09-21', '\t- [ ] 子1', '', '\t- [ ] 子2', ''].join('\n'),
        );
        expect(idOf(session, '対象')).toBe(held.target);
        expect(idOf(session, '子1')).toBe(held.first);
        expect(idOf(session, '子2')).toBe(held.second);
        expect(Notice.messages).toEqual([]);
    });

    it('moves whole to another file, and nothing of it stays behind', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] 対象 @2026-09-21 ==> move([[archive]])', '\t- [ ] 子1', '', '\t- [ ] 子2', '- [ ] 下', ''],
            [ARCHIVE]: ['# archive', ''],
        });

        await complete(session, '対象', ARCHIVE);

        expect(contents.get(FILE)).toBe(['# note', '- [ ] 下', ''].join('\n'));
        expect(contents.get(ARCHIVE)).toBe(
            ['# archive', '- [x] 対象 @2026-09-21', '\t- [ ] 子1', '', '\t- [ ] 子2', ''].join('\n'),
        );
        expect(Notice.messages).toEqual([]);
    });

    it('is deleted whole by a deletion fire, leaving no orphan', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] 対象 @2026-09-21', '\t- ==> every mon', '\t- [ ] 子1', '', '\t- [ ] 子2', '', '- [ ] 下', ''],
        });

        expect(await session.index.deleteTask(idOf(session, '対象'), { fireFlow: true })).toBe(true);
        await flowSettled(session);

        const lines = contents.get(FILE)!.split('\n');
        expect(lines).not.toContain('\t- [ ] 子2');
        expect(lines).not.toContain('\t- [ ] 子1');
        expect(lines.filter(line => line.startsWith('- [ ] 対象'))).toHaveLength(1);
        // The blank line after the subtree is not the task's, and stays.
        expect(lines.slice(-3)).toEqual(['', '- [ ] 下', '']);
        expect(Notice.messages).toEqual([]);
    });
});

describe('a fence below a blank line whose closing line is at column 0', () => {
    // The fence opens inside the subtree; its closing line, or a line of it,
    // is no deeper than the task. A subtree that ended there left half the
    // fence behind, and the closing line left alone opened a fence that
    // swallowed the tasks below it (found by the F4 counterexample run).
    const NOTE = ['# note', '- [ ] T @2026-09-21', '', '  ```js', 'code', '```', '- [ ] U', ''];

    it('goes whole with a delete, and the task below stays a task', async () => {
        const { contents, session } = await open({ [FILE]: NOTE });
        const u = idOf(session, 'U');

        expect(await session.index.deleteTask(idOf(session, 'T'))).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(['# note', '- [ ] U', ''].join('\n'));
        expect(idOf(session, 'U')).toBe(u);
    });

    it('goes whole with a move within the file, and every task keeps its ID', async () => {
        const note = ['# note', '- [ ] T @2026-09-21 ==> move([[note]])', '', '  ```js', 'code', '```', '- [ ] U', ''];
        const { contents, session } = await open({ [FILE]: note });
        const held = { t: idOf(session, 'T'), u: idOf(session, 'U') };

        await complete(session, 'T');

        expect(contents.get(FILE)).toBe(
            ['# note', '- [ ] U', '- [x] T @2026-09-21', '', '  ```js', 'code', '```', ''].join('\n'),
        );
        expect(idOf(session, 'T')).toBe(held.t);
        expect(idOf(session, 'U')).toBe(held.u);
    });

    it('goes whole with a copy placed before the task, which keeps its ID', async () => {
        const { contents, session } = await open({ [FILE]: NOTE });
        const held = { t: idOf(session, 'T'), u: idOf(session, 'U') };

        await session.index.duplicateTask(held.t, { dayOffset: 1 });
        await session.settle(FILE);

        const lines = contents.get(FILE)!.split('\n');
        expect(lines.filter(line => line === '```')).toHaveLength(2);
        expect(session.index.getTask(held.t)?.content).toBe('T');
        expect(idOf(session, 'U')).toBe(held.u);
    });
});

describe('a checkbox indented by full-width spaces', () => {
    // Obsidian does not nest it: its metadata reads the line as P going on,
    // not as a list item (R0), so it is no task here either (L1). F4's B4 was
    // a write that took such a line's full-width spaces off; whatever the
    // line is read as, no write may do that.
    it('is no task and no child, and a write to its parent leaves it as it was', async () => {
        const { contents, session } = await open({ [FILE]: ['# note', '- [ ] P', '\u3000\u3000- [ ] 子', ''] });
        expect(session.index.getTasks().map(task => task.content)).toEqual(['P']);

        await complete(session, 'P');

        expect(contents.get(FILE)).toBe(['# note', '- [x] P', '\u3000\u3000- [ ] 子', ''].join('\n'));
    });
});

describe('a command line below a blank line', () => {
    it('is the task\'s command: completing the task fires it and consumes it', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] 対象 @2026-09-21', '', '\t- ==> every mon', '- [ ] 下', ''],
        });
        expect(session.index.getTasks().find(task => task.content === '対象')!.flow?.program).toBeTruthy();

        await complete(session, '対象');

        // The command went with the next instance and left the completed row;
        // the blank line it stood below stays where it was.
        expect(contents.get(FILE)!.split('\n')).toEqual([
            '# note', '- [ ] 対象 @2026-09-28', '\t- ==> every mon', '- [x] 対象 @2026-09-21', '', '- [ ] 下', '',
        ]);
        expect(Notice.messages).toEqual([]);
    });
});
