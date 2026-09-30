import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { t } from '../../../../src/i18n';
import { openLiveVault, type VaultSession } from '../../helpers/vaultSession';
import { inheritedAt } from '../../../../src/services/data/InheritedValues';
import { DEFAULT_SETTINGS } from '../../../../src/types';

/**
 * `TaskIndex.rowSnapshot`: the copy of a row and the note's lines it was read
 * in, handed out only when the copy is the row on the disk — the check every
 * write makes (`planCopy`), keeping the lines it read.
 */

const FILE = 'note.md';
const NOTE = ['---', 'owner: me', '---', '## Work', '- [ ] A @2026-09-21', '    - [ ] child', '- [ ] B @2026-09-21', ''];
const OUTSIDE = ['---', 'owner: me', '---', '## Work', 'メモ', '- [ ] A @2026-09-21', '    - [ ] child', '- [ ] B @2026-09-21', ''];

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });
beforeEach(() => { Notice.messages.length = 0; });

const open = () => openLiveVault({ [FILE]: NOTE }, (s) => { live = s; });

function idOf(session: VaultSession, content: string): string {
    const task = session.index.getTasks().find(row => row.file === FILE && row.content === content);
    if (!task) throw new Error(`no row reads ${content}`);
    return task.id;
}

describe('rowSnapshot', () => {
    it('the copy and the lines of the disk, the copy on its own line of them', async () => {
        const { session } = await open();
        const snapshot = await session.ops.rowSnapshot(idOf(session, 'A'));
        expect(snapshot?.lines).toEqual(NOTE);
        expect(snapshot?.task.content).toBe('A');
        expect(snapshot?.lines[snapshot.task.line]).toBe(snapshot?.task.originalText);
        expect(Notice.messages).toEqual([]);
    });

    it('what the row inherits is read off the snapshot, for a child row as well', async () => {
        const { session } = await open();
        const snapshot = (await session.ops.rowSnapshot(idOf(session, 'child')))!;
        expect(inheritedAt(snapshot.lines, snapshot.task.line, DEFAULT_SETTINGS).map(v => v.yaml)).toEqual([['owner: me']]);
    });

    it('over an edit from outside no scan read: none, told once, and the next name has one', async () => {
        const { contents, session } = await open();
        const id = idOf(session, 'A');
        contents.set(FILE, OUTSIDE.join('\n'));

        expect(await session.ops.rowSnapshot(id)).toBeUndefined();
        expect(Notice.messages).toEqual([t('notice.readAgain', { subject: 'A' })]);

        const snapshot = await session.ops.rowSnapshot(idOf(session, 'A'));
        expect(snapshot?.lines).toEqual(OUTSIDE);
        expect(snapshot?.task.line).toBe(5);
    });

    it('a name from before a write of ours: the copy that write left, in the lines it left', async () => {
        const { contents, session } = await open();
        const id = idOf(session, 'A');
        expect(await session.ops.updateTask(id, { statusChar: 'x' })).toBe(true);

        const snapshot = await session.ops.rowSnapshot(id);
        expect(snapshot?.task.statusChar).toBe('x');
        expect(snapshot?.lines.join('\n')).toBe(contents.get(FILE));
    });

    it('a row the index no longer holds: none', async () => {
        const { session } = await open();
        const id = idOf(session, 'A');
        expect(await session.ops.deleteTask(id)).toBe(true);
        Notice.messages.length = 0;
        expect(await session.ops.rowSnapshot(id)).toBeUndefined();
    });
});

describe('rowSnapshot while the note is dragged', () => {
    it('a copy read before our own write the index holds back: none, nothing told', async () => {
        const { session } = await open();
        const id = idOf(session, 'A');
        session.index.setDraggingFile(FILE);
        expect(await session.ops.updateTask(id, { statusChar: 'x' })).toBe(true);
        Notice.messages.length = 0;

        // The store still holds the reading from before the write, under its name.
        expect(session.index.getTask(id)?.id).toBe(id);
        expect(await session.ops.rowSnapshot(id)).toBeUndefined();
        expect(Notice.messages).toEqual([]);

        session.index.setDraggingFile(null);
        await session.settle(FILE);
        const snapshot = await session.ops.rowSnapshot(idOf(session, 'A'));
        expect(snapshot?.task.statusChar).toBe('x');
    });
});
