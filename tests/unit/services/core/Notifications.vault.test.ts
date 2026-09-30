import { describe, it, expect, afterEach } from 'vitest';
import { openLiveVault, makeFile, type VaultSession } from '../../helpers/vaultSession';

/**
 * What the views are told, and when, after a write of ours or a change event
 * (structure/layers.md, 通知). A listener of the index hears either a span
 * (a row's name and the fields that moved) or a full invalidation (no
 * arguments). The index merges what one frame (16ms) asks into one telling
 * (`NotifyCoalescer`).
 */

const NOTE = 'note.md';
let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

/** Every telling a listener heard, as `span <name> <fields>` or `full`. */
function listen(session: VaultSession): string[] {
    const heard: string[] = [];
    session.index.onChange((taskId, changes) => {
        heard.push(taskId && changes ? `span ${changes.join(',')}` : 'full');
    });
    return heard;
}

/** Past one frame of the coalescer. */
const frame = () => new Promise<void>(resolve => setTimeout(resolve, 40));

/** A session over `text`, read, and past what reading the vault tells. */
async function openQuiet(text: string) {
    const opened = await openLiveVault(text, s => { live = s; });
    await frame();
    return opened;
}

describe('what a write of ours tells the views', () => {
    it('an update is told once, after the frame the write landed in', async () => {
        const { session } = await openQuiet('- [ ] a @2026-10-01\n');
        const heard = listen(session);
        const row = session.index.getTasks()[0];

        await session.ops.updateTask(row.id, { statusChar: 'x' });
        const atReturn = [...heard];
        await frame();

        expect(atReturn).toEqual([]);
        expect(heard).toEqual(['full']);
    });

    it('a line put beside a row is told once, after the frame the write landed in', async () => {
        const { session } = await openQuiet('- [ ] a @2026-10-01\n');
        const heard = listen(session);
        const row = session.index.getTasks()[0];

        await session.ops.insertLine(row.id, '- [ ] child', 'firstChild');
        const atReturn = [...heard];
        await frame();

        expect(atReturn).toEqual([]);
        expect(heard).toEqual(['full']);
    });
});

describe('what a change event tells the views', () => {
    it('a modify that reads what the index already holds tells nothing', async () => {
        const { session } = await openQuiet('- [ ] a @2026-10-01\n');
        const heard = listen(session);

        await session.fireVault('modify', makeFile(NOTE));
        await frame();

        expect(heard).toEqual([]);
    });

    it('a modify that reads a change from outside is told once', async () => {
        const { contents, session } = await openQuiet('- [ ] a @2026-10-01\n');
        const heard = listen(session);

        contents.set(NOTE, '- [ ] a @2026-10-02\n');
        await session.fireVault('modify', makeFile(NOTE));
        await frame();

        expect(heard).toEqual(['full']);
    });
});

describe('who hears that a row was deleted', () => {
    /** Every name the index says ended, in order. */
    function hearDeletes(session: VaultSession): string[] {
        const deleted: string[] = [];
        session.index.onTaskDeleted(id => deleted.push(id));
        return deleted;
    }
    const byLine = (session: VaultSession) => session.index.getTasks().sort((x, y) => x.line - y.line);
    /** Past the task the index tells the names that ended in. */
    const settled = () => new Promise<void>(resolve => setTimeout(resolve, 0));

    it('a delete of ours ends the row and its subtree, told in the task after; the rows after it go on', async () => {
        const { session } = await openQuiet('- [ ] a\n    - [ ] a1\n- [ ] b\n');
        const deleted = hearDeletes(session);
        const [a, a1, b] = byLine(session);

        expect(await session.ops.deleteTask(a.id)).toBe(true);
        expect(deleted).toEqual([]);
        await settled();

        expect(deleted.sort()).toEqual([a.id, a1.id].sort());
        expect(session.index.getTask(b.id)?.content).toBe('b');
    });

    it('a rewrite of ours ends nothing, though the scan its change event starts commits before the write reports', async () => {
        // The session's vault runs the `modify` scan inside `vault.process`,
        // so the scan commits what the write left before `landed` links it.
        const { session } = await openQuiet('- [ ] a\n- [ ] b\n');
        const deleted = hearDeletes(session);
        const [a] = byLine(session);

        await session.ops.updateTask(a.id, { statusChar: 'x' });
        await session.ops.insertLine(a.id, '- [ ] new', 'firstChild');
        await settled();

        expect(deleted).toEqual([]);
    });

    it('an edit from outside ends every name of the file, as it does the names', async () => {
        const { contents, session } = await openQuiet('- [ ] a\n- [ ] b\n');
        const deleted = hearDeletes(session);
        const [a, b] = byLine(session);

        contents.set(NOTE, '- [ ] a\n');
        await session.fireVault('modify', makeFile(NOTE));
        await settled();

        expect(deleted.sort()).toEqual([a.id, b.id].sort());
    });

    it('a change event that reads what the index holds ends nothing', async () => {
        const { session } = await openQuiet('- [ ] a\n');
        const deleted = hearDeletes(session);

        await session.fireVault('modify', makeFile(NOTE));
        await settled();

        expect(deleted).toEqual([]);
    });

    it('a note deleted or renamed ends every row of it', async () => {
        const { contents, session } = await openQuiet('- [ ] a\n');
        const deleted = hearDeletes(session);
        const [a] = byLine(session);

        contents.set('moved.md', contents.get(NOTE)!);
        contents.delete(NOTE);
        await session.fireVault('rename', makeFile('moved.md'), NOTE);
        await settled();
        const [moved] = byLine(session);
        expect(deleted).toEqual([a.id]);

        contents.delete('moved.md');
        await session.fireVault('delete', makeFile('moved.md'));
        await settled();
        expect(deleted).toEqual([a.id, moved.id]);
    });

    it('a listener that throws stops neither the others nor the reading', async () => {
        const { contents, session } = await openQuiet('- [ ] a\n');
        session.index.onTaskDeleted(() => { throw new Error('boom'); });
        const deleted = hearDeletes(session);
        const [a] = byLine(session);

        contents.set(NOTE, '- [ ] b\n');
        await session.fireVault('modify', makeFile(NOTE));
        await settled();

        expect(deleted).toEqual([a.id]);
        expect(byLine(session)[0].content).toBe('b');
    });
});

describe('what the end of a drag draws', () => {
    it('draws the note read again once the drag lets go of it, not the copy the drag began on', async () => {
        const { session } = await openQuiet('- [ ] a @2026-10-01\n');
        const heard = listen(session);
        const row = session.index.getTasks()[0];

        session.index.setDraggingFile(NOTE);
        await session.ops.updateTask(row.id, { startDate: '2026-10-02' });
        // The write does not change the copy: the note is held.
        expect(session.index.getTask(row.id)?.startDate).toBe('2026-10-01');
        await session.index.setDraggingFile(null);
        expect(session.index.getTasks()[0].startDate).toBe('2026-10-02');
        session.index.notifyImmediate();
        await frame();

        expect(heard).toEqual(['full']);
    });
});
