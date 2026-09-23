import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

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
    const contents = new Map([[FILE, lines.join('\n')]]);
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
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
        session.index.setDraggingFile(FILE);

        expect(await session.index.updateTask(id, { content: 'A2' })).toBe(true);
        expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(true);

        expect(contents.get(FILE)).toBe(['# note', '- [x] A2 @2026-09-21', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });

    it('lets a deletion fire through', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', '']);
        const id = idOf(session, 'A');
        session.index.setDraggingFile(FILE);

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
        session.index.setDraggingFile(FILE);

        expect(await session.index.updateTask(id, { properties: { memo: { value: 'new', type: 'string' } } } as never)).toBe(true);
        expect(contents.get(FILE)).toContain('\t- memo:: new');
        expect(await session.index.deleteTask(id)).toBe(true);

        expect(contents.get(FILE)).toBe(['# note', '- [ ] Z', ''].join('\n'));
    });

    it('still refuses what the update did not write: an edit from outside after it', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-09-21', '']);
        const id = idOf(session, 'A');
        session.index.setDraggingFile(FILE);

        expect(await session.index.updateTask(id, { content: 'A2' })).toBe(true);
        const edited = ['# note', '- [ ] A2 書き足し @2026-09-21', ''].join('\n');
        contents.set(FILE, edited);

        expect(await session.index.updateTask(id, { statusChar: 'x' })).toBe(false);
        expect(contents.get(FILE)).toBe(edited);
    });
});
