import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * A line written as a task's child takes the indentation of the task's first
 * child: the first list item the outline reads under the task's item.
 *
 * It used to take the first line of the subtree that was not blank. Since the
 * subtree is read as Obsidian reads an item (stage L2), that line can be a
 * paragraph going on at column 0 or indented four columns past the task's
 * content: a child written at its indentation was a sibling at the top, or a
 * paragraph line, and the next instance of a series lost its `==>` line and
 * stopped (the L2 counterexample run).
 */

const FILE = 'note.md';

let live: VaultSession | undefined;

beforeEach(() => {
    Notice.messages.length = 0;
});

afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(lines: string[]): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const contents = new Map([[FILE, lines.join('\n')]]);
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

function taskWorded(session: VaultSession, content: string) {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0];
}

/**
 * The lines below the task that are no child of it: a paragraph going on. With
 * no child to copy, the indentation comes from the rest of the file.
 */
const NOT_A_CHILD = [
    ['at column 0', 'lazy text', '\t'],
    ['four columns past the task\'s content', '      deep text', '    '],
];

describe.each(NOT_A_CHILD)('a line of the subtree %s', (_name, line, unit) => {
    const NOTE = ['# note', '- [ ] T', line, '- [ ] U', ''];

    it('lends no indentation to a last child', async () => {
        const { contents, session } = await open(NOTE);

        await session.index.appendChildTask(taskWorded(session, 'T').id, '- [ ] c');
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toEqual(['# note', '- [ ] T', line, `${unit}- [ ] c`, '- [ ] U', '']);
        expect(taskWorded(session, 'c').parentId).toBe(taskWorded(session, 'T').id);
    });

    it('lends no indentation to a first child', async () => {
        const { contents, session } = await open(NOTE);

        expect(await session.index.insertChildTask(taskWorded(session, 'T').id, '- [ ] c')).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n').slice(0, 3)).toEqual(['# note', '- [ ] T', `${unit}- [ ] c`]);
        expect(taskWorded(session, 'c').parentId).toBe(taskWorded(session, 'T').id);
    });

    it('lends no indentation to a property line', async () => {
        const { contents, session } = await open(NOTE);

        await session.index.updateTask(taskWorded(session, 'T').id,
            { properties: { memo: { value: 'new', type: 'string' } } } as never);
        await session.settle(FILE);

        expect(contents.get(FILE)!.split('\n')).toContain(`${unit}- memo:: new`);
        expect(taskWorded(session, 'T').properties?.memo?.value).toBe('new');
    });

    it('lends no indentation to the next instance\'s command, which keeps the series going', async () => {
        const { contents, session } = await open(['# note', '- [ ] 対象 @2026-09-21', line, '\t- ==> every mon', '- [ ] U', '']);

        expect(await session.index.updateTask(taskWorded(session, '対象').id, { statusChar: 'x' })).toBe(true);
        const executor = (session.index as unknown as { commandExecutor: { isProcessing: boolean; taskQueue: unknown[] } }).commandExecutor;
        await vi.waitFor(() => {
            expect(executor.isProcessing).toBe(false);
            expect(executor.taskQueue).toHaveLength(0);
        });
        await session.settle(FILE);

        const lines = contents.get(FILE)!.split('\n');
        expect(lines.slice(0, 3)).toEqual(['# note', '- [ ] 対象 @2026-09-28', '\t- ==> every mon']);
        const next = session.index.getTasks().find(task => task.line === 1)!;
        expect(next.flow?.program).toBeTruthy();
        expect(Notice.messages).toEqual([]);
    });
});

/**
 * A child a move carries is written with its indentation cut by as many
 * characters as the task's own (`FileOperations.adjustChildIndentation`), not
 * by the columns the task moved: from under a tab-indented task, eight spaces
 * lose one and land seven past the task's new row, four past its content, a
 * paragraph line (the fourth L2 counterexample run, G3, M14). Adding lines
 * goes through `Placement` in P1, which reads the lines it puts.
 */
describe('a child carried by a move to another note', () => {
    it.fails('stays the moved task\'s child', async () => {
        const contents = new Map([
            [FILE, ['# note', '- [ ] P', '\t- [ ] X @2026-09-21 ==> move([[other]])', '        - [ ] c', ''].join('\n')],
            ['other.md', '# other\n'],
        ]);
        live = vaultSession(contents);
        await live.scanAll();
        const session = live;

        expect(await session.index.updateTask(taskWorded(session, 'X').id, { statusChar: 'x' })).toBe(true);
        const executor = (session.index as unknown as { commandExecutor: { isProcessing: boolean; taskQueue: unknown[] } }).commandExecutor;
        await vi.waitFor(() => {
            expect(executor.isProcessing).toBe(false);
            expect(executor.taskQueue).toHaveLength(0);
        });
        await session.settle(FILE);
        await session.settle('other.md');

        const moved = session.index.getTasks().filter(task => task.file === 'other.md');
        const c = moved.find(task => task.content === 'c');
        expect(c?.parentId).toBe(moved.find(task => task.content === 'X')?.id);
    });
});
