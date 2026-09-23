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

/** For each row now, the index of the row before whose name it carries, or -1. */
async function carried(before: string[], after: string[]): Promise<number[]> {
    const session = await open(before);
    const was = ids(session);
    await fromOutside(session, after);
    return ids(session).map(id => was.indexOf(id));
}

describe('what counts as the other row, and which pairs are looked at', () => {
    it('a row in the words of a pair and the place of another row: neither keeps its name', async () => {
        // `\t- [ ] A @d` reads as A's child did and sits right after P, where A
        // sat; `- [x] A @d` reads as A up to its status. Twins up to the
        // indentation and the status: the lines cannot tell them apart. (M6
        // kept the pair on content and dates, as held by its own words.)
        expect(await carried(['- [ ] P', `- [ ] A${D}`, `\t- [ ] A${D}`, ''], ['- [ ] P', `\t- [ ] A${D}`, `- [x] A${D}`, '']))
            .toEqual([0, -1, -1]);
    });

    it('a twin that reads as the previous row word for word is weighed like any other row', async () => {
        // The first `\t- [ ] B` sits where A's child sat and reads as it but
        // for the indentation; the last reads as the grandchild word for word
        // and sits elsewhere. Twins: both B rows are new. (M7 left a word for
        // word row out of the check.)
        expect(await carried(['- [ ] A', '\t- [ ] B', '\t\t- [ ] B', ''], ['\t- [ ] B', '\t- [ ] A', '\t- [ ] B', '']))
            .toEqual([-1, 0, -1]);
    });

    it('a pair made at rung 4 is weighed like any other pair', async () => {
        // `\t- [x] A @d` sits right after C, where the last A sat, and is paired
        // with the other `- [x] A @d`; the last A is paired with `- [x] A` on
        // its content alone. The words cross the two pairs, and neither is
        // taken. (M8 left rung-4 pairs to a guard of their own.)
        expect(await carried([`- [ ] A${D}`, `- [x] A${D}`, `- [x] C${D}`, `- [x] A${D}`, ''], [`- [ ] A${D}`, `- [x] C${D}`, `\t- [x] A${D}`, '- [x] A', '']))
            .toEqual([0, 2, -1, -1]);
    });

    it('a `^id` on two rows settles nothing: the place and the words still disagree', async () => {
        expect(await carried(['- [ ] P', '- [ ] A ^b1', ''], ['- [ ] P', '\t- [ ] A ^b1', '- [ ] A ^b1', '']))
            .toEqual([0, -1, -1]);
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
