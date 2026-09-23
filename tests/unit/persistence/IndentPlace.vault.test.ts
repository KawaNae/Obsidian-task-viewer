import { describe, it, expect, afterEach } from 'vitest';
import { vaultSession, makeFile, type VaultSession } from '../helpers/vaultSession';

/**
 * A row whose indent was changed by hand, left where it sat, while a row of
 * its old words under its old indentation was typed elsewhere. The ladder
 * pairs a row by its text with the indentation (rung 2), so the typed row
 * used to take the name and a card wrote there (the I1 counterexample run's
 * G1: fuzz 81, 611, 854). The same lines are what a row moved away and one
 * typed in its place under another indentation leave; the place says one
 * thing and the text another. Neither is taken: the name goes and both rows
 * are new (I1). Where the row left its place as well (fuzz 145), nothing in
 * the lines points at it, and the ladder follows the text — a move.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;
let contents = new Map<string, string>();
afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(lines: string[]): Promise<VaultSession> {
    contents = new Map([[FILE, lines.join('\n')]]);
    live = vaultSession(contents);
    await live.scanAll();
    return live;
}

const ids = (session: VaultSession): string[] => session.index.getTasks()
    .filter(task => task.file === FILE)
    .sort((a, b) => a.line - b.line)
    .map(task => task.id);

async function fromOutside(session: VaultSession, lines: string[]): Promise<void> {
    contents.set(FILE, lines.join('\n'));
    await session.fireVault('modify', makeFile(FILE));
    await session.settle(FILE);
}

const D = ' @2026-09-21';

describe('a row indented in its place, its old words typed elsewhere: the name goes to neither', () => {
    it('indented under the row before it, typed at the top (fuzz 81)', async () => {
        const session = await open([`- [ ] B${D}`, `- [ ] C${D}`, '- [ ] A', '']);
        const [b, c, x] = ids(session);
        await fromOutside(session, ['- [ ] A', `- [ ] B${D}`, `- [ ] C${D}`, '\t- [ ] A', '']);
        const now = ids(session);
        expect(now.slice(1, 3)).toEqual([b, c]);
        expect(now).not.toContain(x);
    });

    it('indented under the row before it, typed after it (fuzz 611)', async () => {
        const session = await open(['- [x] A', '- [ ] B', '- [x] B', '']);
        const [a, x] = ids(session);
        await fromOutside(session, ['- [x] A', '\t- [ ] B', '- [ ] B', '']);
        const now = ids(session);
        expect(now[0]).toBe(a);
        expect(now).not.toContain(x);
    });

    it('the first row indented, typed below it (fuzz 854)', async () => {
        const session = await open(['- [x] A', '- [ ] C', '']);
        const [x, c] = ids(session);
        await fromOutside(session, ['\t- [x] A', '- [x] A', '- [ ] C', '']);
        const now = ids(session);
        expect(now[2]).toBe(c);
        expect(now).not.toContain(x);
    });
});

describe('a row that left its place as well follows its text', () => {
    it('a child outdented above its parent, its old words typed below (fuzz 145)', async () => {
        const session = await open([`- [ ] A${D}`, '\t- [ ] B', '']);
        const [a, x] = ids(session);
        await fromOutside(session, ['- [ ] B', '\t- [ ] B', `- [ ] A${D}`, '']);
        const now = ids(session);
        expect(now[1]).toBe(x);
        expect(now[2]).toBe(a);
    });
});

describe('a plain indent keeps its name', () => {
    it('with no other row of its words', async () => {
        const session = await open(['- [ ] P', '- [ ] A', '']);
        const [p, x] = ids(session);
        await fromOutside(session, ['- [ ] P', '\t- [ ] A', '']);
        expect(ids(session)).toEqual([p, x]);
    });
});
