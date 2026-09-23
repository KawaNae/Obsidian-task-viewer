import { describe, it, expect, afterEach } from 'vitest';
import { vaultSession, makeFile, type VaultSession } from '../helpers/vaultSession';

/**
 * Rung 4 of the ladder (the one row left on each side, sharing its text or
 * its dates) used to be decided scope by scope in the first pass, before the
 * second pass could find a row by its exact text under a new parent. A row
 * an outside edit cut off from its parent took the name of the root a card
 * deleted, and a new parent line took the name of the root it was put over
 * (the F4–F6 comprehensive review's counterexample 2). Rung 4 is now decided
 * only where neither side has a stronger candidate anywhere in the file; where
 * the scope and the text elsewhere disagree, neither is taken and both rows
 * of the pair are new (I1). A name is lost; none goes to the wrong row.
 *
 * The shapes are the review's probes (`DeletedNameReused.probe.test.ts`,
 * `Reparent.probe.test.ts`). The probes held writes and outside edits back
 * without any `modify`; here a drag holds the scans while every change is
 * heard, as in use.
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

const tasks = (session: VaultSession) => session.index.getTasks()
    .filter(task => task.file === FILE)
    .sort((a, b) => a.line - b.line);
const idOf = (session: VaultSession, content: string): string => {
    const found = tasks(session).filter(task => task.content === content);
    if (found.length !== 1) throw new Error(`idOf(${content}): ${found.length}`);
    return found[0].id;
};

async function fromOutside(session: VaultSession, lines: string[]): Promise<void> {
    contents.set(FILE, lines.join('\n'));
    await session.fireVault('modify', makeFile(FILE));
    await session.settle(FILE);
}

async function release(session: VaultSession): Promise<void> {
    session.index.setDraggingFile(null);
    await session.settle(FILE);
}

describe('a row that leaves its parent: the name of a root that went goes to no other row', () => {
    const NOTE = ['# h', '- [x] 消す @2026-09-21', '- [ ] 親 @2026-09-21', '\t- [ ] 子A @2026-09-21', '\t- [ ] 子B @2026-09-21 ==> every mon', ''];
    const SPLIT = ['# h', '- [x] 消す @2026-09-21', '- [ ] 親 @2026-09-21', '\t- [ ] 子A @2026-09-21', 'para', '\t- [ ] 子B @2026-09-21 ==> every mon', ''];
    const AFTER = ['# h', '- [ ] 親 @2026-09-21', '\t- [ ] 子A @2026-09-21', 'para', '\t- [ ] 子B @2026-09-21 ==> every mon', ''];

    const verdict = (session: VaultSession, b: string, deleted: string) => {
        const now = idOf(session, '子B');
        return now === b ? 'kept' : now === deleted ? 'took the deleted name' : 'new';
    };

    it('a card delete that lands after an outside edit (a mark)', async () => {
        const session = await open(NOTE);
        const deleted = idOf(session, '消す');
        const b = idOf(session, '子B');
        session.index.setDraggingFile(FILE);
        await fromOutside(session, SPLIT);
        expect(await session.index.deleteTask(deleted)).toBe(true);
        await release(session);
        expect(contents.get(FILE)!.split('\n')).toEqual(AFTER);
        expect(verdict(session, b, deleted)).toBe('new');
    });

    it('the same with the outside edit after the delete (a record)', async () => {
        const session = await open(NOTE);
        const deleted = idOf(session, '消す');
        const b = idOf(session, '子B');
        session.index.setDraggingFile(FILE);
        expect(await session.index.deleteTask(deleted)).toBe(true);
        await fromOutside(session, AFTER);
        await release(session);
        expect(verdict(session, b, deleted)).toBe('kept');
    });

    it('an outside edit alone (a sync) that removes a root and splits a child off', async () => {
        const session = await open(NOTE);
        const deleted = idOf(session, '消す');
        const b = idOf(session, '子B');
        await fromOutside(session, AFTER);
        expect(verdict(session, b, deleted)).toBe('new');
    });
});

describe('a root that gains a parent from outside: its name goes to no other row', () => {
    it.each([
        ['indented root under a heading', ['# h', '\t- [ ] m', '- [ ] t1', ''], ['# h', '- [ ] n', '\t- [ ] m', '- [ ] t1', ''], 'new'],
        ['root at depth 0 indented under a new parent', ['# h', '- [ ] m', '- [ ] t1', ''], ['# h', '- [ ] n', '\t- [ ] m', '- [ ] t1', ''], 'new'],
        ['child moved to a new parent', ['# h', '- [ ] p', '\t- [ ] m', '- [ ] t1', ''], ['# h', '- [ ] p', '- [ ] n', '\t- [ ] m', '- [ ] t1', ''], 'kept'],
    ])('%s', async (_name, from, to, kept) => {
        const session = await open(from);
        const m = idOf(session, 'm');
        await fromOutside(session, to);
        expect({ m: idOf(session, 'm') === m ? 'kept' : 'new', n: idOf(session, 'n') === m ? 'n took m' : 'n new' }).toEqual({ m: kept, n: 'n new' });
    });
});

describe('two scopes whose rows were rewritten into each other\'s words', () => {
    // A guard that counted every unpaired row as a stronger candidate would
    // have each scope's rung-4 pair block the other's, and the second pass
    // would pair the rows across scopes by their text — a confident swap. The
    // rows another held-back pair holds do not count against it.
    it('each row keeps its name under its own parent', async () => {
        const session = await open(['- [ ] P1', '\t- [ ] A', '- [ ] P2', '\t- [ ] B', '']);
        const p = idOf(session, 'A');
        const q = idOf(session, 'B');
        await fromOutside(session, ['- [ ] P1', '\t- [ ] A2', '- [ ] P2', '\t- [ ] A', '']);
        expect(idOf(session, 'A2')).toBe(p);
        expect(idOf(session, 'A')).toBe(q);
    });
});

describe('a root rewritten into its child\'s words', () => {
    // The child reads as the root now reads (content and date), so it is a
    // stronger candidate for the root's rung-4 pair. But its own twin is the
    // child below the pair: both subtrees move with the pair, and that
    // evidence agrees with it. Counted against the pair, it would hold the
    // pair until nothing more could be decided, and the root would lose its
    // name to a scope that had not opened yet.
    it('the root and its child keep their names', async () => {
        const session = await open(['- [ ] A @2026-09-21', '\t- [x] B @2026-09-21', '']);
        const [root, child] = tasks(session).map(task => task.id);
        await fromOutside(session, ['- [ ] B @2026-09-21', '\t- [x] B @2026-09-21', '']);
        expect(tasks(session).map(task => task.id)).toEqual([root, child]);
    });

    // The exception is for a child whose strongest match lies wholly below
    // the other side. A child whose own words the other side now reads, with
    // only its content and date matched below, still blocks the pair.
    it('a root deleted over a child and grandchild of one content: no name shifts up (fuzz r4 3432)', async () => {
        const session = await open(['- [x] B @2026-09-21', '\t- [x] D @2026-09-21', '\t\t- [ ] D @2026-09-21', '']);
        const [root, child, grandchild] = tasks(session).map(task => task.id);
        await fromOutside(session, ['\t- [x] D @2026-09-21', '\t\t- [ ] D @2026-09-21', '']);
        const [first, second] = tasks(session).map(task => task.id);
        expect([first, second]).not.toContain(root);
        expect(second).not.toBe(child);
        expect(second).toBe(grandchild);
    });
});
