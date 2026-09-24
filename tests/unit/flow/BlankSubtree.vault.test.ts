import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { freezeDate } from '../helpers/fakeDate';

// Frozen so `==> every mon` on `@2026-09-21` lands on the `@2026-09-28` these
// tests hard-code, no matter which day the suite runs.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

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
    const opened = await openVault(files);
    live = opened.session;
    return opened;
}

function idOf(session: VaultSession, content: string, file = FILE): string {
    const found = session.index.getTasks().filter(task => task.file === file && task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

async function complete(session: VaultSession, content: string, ...paths: string[]): Promise<void> {
    expect(await session.index.updateTask(idOf(session, content), { statusChar: 'x' })).toBe(true);
    await session.flowSettled(FILE, ...paths);
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
        await session.flowSettled(FILE);

        const lines = contents.get(FILE)!.split('\n');
        expect(lines).not.toContain('\t- [ ] 子2');
        expect(lines).not.toContain('\t- [ ] 子1');
        expect(lines.filter(line => line.startsWith('- [ ] 対象'))).toHaveLength(1);
        // The blank line after the subtree is not the task's, and stays.
        expect(lines.slice(-3)).toEqual(['', '- [ ] 下', '']);
        expect(Notice.messages).toEqual([]);
    });
});

describe('a fence below a blank line whose closing line is at column 0 (Obsidian, measurement.md q8)', () => {
    // The fence opens inside T's item, and `code` at column 0 goes on it (and
    // on T). The delimiter at column 0 does not close it: it starts a block
    // of its own, which ends T and its fence and opens a fence that never
    // closes and holds U. U is code, not a task, before any write, as
    // Obsidian draws it. Under the old depth reading the subtree took the
    // fence whole and U was a task (found by the F4 counterexample run).
    const NOTE = ['# note', '- [ ] T @2026-09-21', '', '  ```js', 'code', '```', '- [ ] U', ''];

    it('reads U as code', async () => {
        const { session } = await open({ [FILE]: NOTE });
        expect(session.index.getTasks().map(task => task.content)).toEqual(['T']);
    });

    it('takes T\'s item with a delete, and leaves the lines after it as they were', async () => {
        const { contents, session } = await open({ [FILE]: NOTE });

        expect(await session.index.deleteTask(idOf(session, 'T'))).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(['# note', '```', '- [ ] U', ''].join('\n'));
        expect(session.index.getTasks()).toEqual([]);
    });

    it('refuses a move to the end of the note, which ends inside the fence U is in', async () => {
        const note = ['# note', '- [ ] T @2026-09-21 ==> move([[note]])', '', '  ```js', 'code', '```', '- [ ] U', ''];
        const { contents, session } = await open({ [FILE]: note });
        const before = contents.get(FILE)!;
        const t = idOf(session, 'T');

        await complete(session, 'T');

        expect(contents.get(FILE)).toBe(before.replace('- [ ] T', '- [x] T'));
        expect(idOf(session, 'T')).toBe(t);
    });

    it('writes a copy above T whose fence T\'s own line ends, and leaves T a task with its ID', async () => {
        // The copy carries T's fence open, with `code` going on it; T's line
        // below starts an item and ends it, as the delimiter ended T's.
        const { contents, session } = await open({ [FILE]: NOTE });
        const t = idOf(session, 'T');

        expect(await session.index.duplicateTask(t, { dayOffset: 1 })).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual([
            '# note',
            '- [ ] T @2026-09-22', '', '  ```js', 'code',
            '- [ ] T @2026-09-21', '', '  ```js', 'code',
            '```', '- [ ] U', '',
        ]);
        expect(session.index.getTasks().map(task => [task.line, task.content])).toEqual([[1, 'T'], [5, 'T']]);
        expect(session.index.getTask(t)?.line).toBe(5);
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
