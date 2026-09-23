import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * A value holding U+2028 or U+2029 goes into a note and comes back out as the
 * same task with the same value (L1).
 *
 * Obsidian keeps both inside a line and shows the line as one checkbox (R0).
 * Before L1 every line pattern here read `.`, which refuses them, so such a
 * value took its task out of the index; the API and the flows refused it for
 * that reason (F5). Now the readers take them as text, and the inputs let
 * them through. Inside the content they are whitespace, as a space is: at an
 * edge of the content they go, next to a space they fold into one, as an
 * extra space does.
 */

const FILE = 'note.md';
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function open(lines: string[]): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const contents = new Map([[FILE, lines.join('\n')]]);
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

function only(session: VaultSession, content: string) {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found, JSON.stringify(content)).toHaveLength(1);
    return found[0];
}

describe('content holding U+2028 or U+2029', () => {
    for (const [name, sep] of [['U+2028', LS], ['U+2029', PS]] as const) {
        it(`is written, scanned back as the same value, on the same task (${name})`, async () => {
            const { contents, session } = await open(['# note', '- [ ] X @2026-09-21 ==> every 1d', '- [ ] Y', '']);
            const id = only(session, 'X').id;
            const value = `A${sep}B`;

            expect(await session.index.updateTask(id, { content: value })).toBe(true);
            await session.settle(FILE);

            expect(contents.get(FILE)!.split('\n')[1]).toBe(`- [ ] A${sep}B @2026-09-21 ==> every 1d`);
            const read = only(session, value);
            expect(read.id).toBe(id);
            expect(read.flow?.program).toBeTruthy();

            // And it stays a task a later write finds, whose command still
            // fires: the next instance carries the same value.
            expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(true);
            await vi.waitFor(() => expect(session.index.getTasks().filter(task => task.content === value)).toHaveLength(2));
            await session.settle(FILE);
            const rows = session.index.getTasks().filter(task => task.content === value);
            expect(rows.find(task => task.id === id)?.statusChar).toBe('x');
            expect(rows.find(task => task.id !== id)?.statusChar).toBe(' ');
        });
    }

    it('is created as a task that scans back with the same value', async () => {
        const { session } = await open(['# note', '- [ ] Y', '']);

        await session.index.createTask(FILE, `- [ ] A${LS}B`);
        await session.settle(FILE);

        expect(session.index.getTasks().map(task => task.content)).toEqual(['Y', `A${LS}B`]);
    });

    it('is set by a flow, and the next instance reads it back', async () => {
        const note = ['# note', '- [x] A @2026-09-21', `\t- ==> every 1d setContent("x${LS}y")`, ''];
        const { contents, session } = await open(note);
        const executor = (session.index as unknown as {
            commandExecutor: { handleTaskCompletion(task: unknown): Promise<void>; isProcessing: boolean };
        }).commandExecutor;

        await executor.handleTaskCompletion(only(session, 'A'));
        await vi.waitFor(() => expect(executor.isProcessing).toBe(false));
        await session.settle(FILE);

        expect(Notice.messages).toEqual([]);
        expect(contents.get(FILE)!.split('\n')[1]).toMatch(new RegExp(`^- \\[ \\] x${LS}y @\\d{4}-\\d{2}-\\d{2}$`));
        expect(only(session, `x${LS}y`).statusChar).toBe(' ');
    });

    it('is whitespace inside the content: at an edge it goes, as a space does', async () => {
        const { session } = await open(['# note', `- [ ] A${LS}`, '- [ ] B ', '']);

        expect(session.index.getTasks().map(task => task.content)).toEqual(['A', 'B']);
    });
});
