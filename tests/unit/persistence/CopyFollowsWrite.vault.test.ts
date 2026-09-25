import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * Stage F5: a card's update brings the index's copy of the row up to what it
 * wrote, so the next write planned from that copy is not refused against our
 * own write in the moment before the scan reads it.
 *
 * Every write that names a row is checked against the copy it was planned
 * from (`WriteSession.row`). Until the copy followed the write, a deletion
 * fire right after a card's update was always refused (a loss of availability
 * F3 introduced), and a second update would have been too. The scan is held
 * here the way a drag holds it, so each case runs in that moment.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function open(lines: string[]): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const opened = await openVault(lines);
    live = opened.session;
    return opened;
}

function idOf(session: VaultSession, content: string): string {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

describe('after a card\'s update, before any scan', () => {
    it('lets a second update through', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '']);
        const id = idOf(session, 'A');
        session.holdScans();

        expect(await session.index.updateTask(id, { content: 'A2' })).toBe(true);
        expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(true);

        expect(contents.get(FILE)).toBe(['# note', '- [x] A2 @2026-09-21', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    it('lets a deletion fire through', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', '']);
        const id = idOf(session, 'A');
        session.holdScans();

        expect(await session.index.updateTask(id, { content: 'A2' })).toBe(true);
        expect(await session.index.deleteTask(id, { fireFlow: true })).toBe(true);

        // The renamed row went, and the next instance carries the new name.
        const after = contents.get(FILE)!.split('\n');
        expect(after).not.toContain('- [ ] A2 @2026-09-21');
        expect(after.filter(line => line.startsWith('- [ ] A2 @'))).toHaveLength(1);
        expect(after).toContain('\t- ==> every 1d');
        expect(Notice.messages).toEqual([]);
    });

    it('lets a delete through after an update that rewrote a property line', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '\t- memo:: old', '- [ ] Z', '']);
        const id = idOf(session, 'A');
        session.holdScans();

        expect(await session.index.updateTask(id, { properties: { memo: { value: 'new', type: 'string' } } } as never)).toBe(true);
        expect(contents.get(FILE)).toContain('\t- memo:: new');
        expect(await session.index.deleteTask(id)).toBe(true);

        expect(contents.get(FILE)).toBe(['# note', '- [ ] Z', ''].join('\n'));
    });

    it('still refuses what the update did not write: an edit from outside after it', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '']);
        const id = idOf(session, 'A');
        session.holdScans();

        expect(await session.index.updateTask(id, { content: 'A2' })).toBe(true);
        const edited = ['# note', '- [ ] A2 書き足し @2026-09-21', ''].join('\n');
        contents.set(FILE, edited);

        expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
    });
});

describe('a subtree written in from outside before the update', () => {
    // Found by the F5 counterexample run, when the copy was brought up to the
    // write by hand: a card's update planned from the row's line only, so a
    // child written in from outside since the scan did not stop it. Since N1
    // the copy counts only in the content it was read in (`NamedRow.read`):
    // the update is refused, and has the file read again. The copy that
    // reading gives shows the child, and the delete planned from it takes it.
    const ROW = '- [ ] A @2026-09-21 ^keep';

    it('refuses the update; once read, the delete that follows takes it with the row', async () => {
        const { contents, session } = await open(['# note', ROW, '- [ ] Z', '']);
        const id = idOf(session, 'A');
        const edited = ['# note', ROW, '\t- [ ] 外から足した子', '- [ ] Z', ''].join('\n');
        contents.set(FILE, edited);

        expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
        await session.settle(FILE);
        expect(session.index.getTask(id)).toBeUndefined();
        const now = idOf(session, 'A');
        expect(session.index.getTask(now)?.subtreeLines).toEqual([ROW, '\t- [ ] 外から足した子']);

        expect(await session.index.deleteTask(now)).toBe(true);
        expect(contents.get(FILE)).toBe(['# note', '- [ ] Z', ''].join('\n'));
    });
});

describe('writes asked of one row before the one before them is back', () => {
    // Found by the F5 counterexample run's second pass. A card's checkbox does
    // not wait for its update, so two clicks can ask two writes of one row
    // before the first is written. Planned from the copy as it stood when each
    // was asked, the second would be refused against the first — and the
    // user's last click lost. Each is planned once the one before it is back.

    it('lands a check and an uncheck asked back to back, in that order', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '']);
        const id = idOf(session, 'A');

        const written = await Promise.all([
            session.index.updateTask(id, { statusChar: 'x' }),
            session.index.updateTask(id, { statusChar: ' ' }),
        ]);

        expect(written).toEqual([true, true]);
        expect(contents.get(FILE)).toBe(['# note', '- [ ] A @2026-09-21', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    it('lands a rename and a check asked back to back, and a delete asked after them', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '- [ ] Z', '']);
        const id = idOf(session, 'A');
        session.holdScans();

        const done = await Promise.all([
            session.index.updateTask(id, { content: 'A2' }),
            session.index.updateTask(id, { statusChar: 'x' }),
        ]);
        expect(done).toEqual([true, true]);
        expect(contents.get(FILE)).toBe(['# note', '- [x] A2 @2026-09-21', '- [ ] Z', ''].join('\n'));

        expect(await session.index.deleteTask(id)).toBe(true);
        expect(contents.get(FILE)).toBe(['# note', '- [ ] Z', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    it('lands a delete asked while an update of the row is still being written', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '- [ ] Z', '']);
        const id = idOf(session, 'A');
        session.holdScans();

        const done = await Promise.all([
            session.index.updateTask(id, { content: 'A2' }),
            session.index.deleteTask(id),
        ]);

        expect(done).toEqual([true, true]);
        expect(contents.get(FILE)).toBe(['# note', '- [ ] Z', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });
});

describe('an update that rewrites property lines plans from them', () => {
    // Found by the F5 counterexample run's second pass, older than F5. A tag
    // list is written whole from the copy's, so a tag added from outside since
    // the scan would be written over. The update's basis takes in the subtree
    // when it rewrites property lines, and the write is refused instead.

    it('refuses a tag update over a tag added from outside', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '\t- tags:: #a', '']);
        const id = idOf(session, 'A');
        const task = session.index.getTask(id)!;
        session.holdScans();
        const edited = ['# note', '- [ ] A @2026-09-21', '\t- tags:: #a #b', ''].join('\n');
        contents.set(FILE, edited);

        expect(await session.index.updateTask(id, { tags: [...task.tags, 'c'] })).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
    });

    it('still writes a tag update over the lines as they were read', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '\t- tags:: #a', '']);
        const id = idOf(session, 'A');
        const task = session.index.getTask(id)!;

        expect(await session.index.updateTask(id, { tags: [...task.tags, 'c'] })).toBe(true);
        expect(contents.get(FILE)).toContain('#c');
    });
});
