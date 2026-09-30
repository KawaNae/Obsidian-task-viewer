import { describe, it, expect, afterEach } from 'vitest';
import { openLiveVault, makeFile, type VaultSession } from '../../helpers/vaultSession';
import { TaskWriteService } from '../../../../src/services/data/TaskWriteService';

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

        await session.index.updateTask(row.id, { statusChar: 'x' });
        const atReturn = [...heard];
        await frame();

        expect(atReturn).toEqual([]);
        expect(heard).toEqual(['full']);
    });

    it('a line put beside a row is told once, after the frame the write landed in', async () => {
        const { session } = await openQuiet('- [ ] a @2026-10-01\n');
        const heard = listen(session);
        const row = session.index.getTasks()[0];

        await session.index.insertLine(row.id, '- [ ] child', 'firstChild');
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
    it('a delete through the write service is heard; one straight to the index is not', async () => {
        const { session } = await openQuiet('- [ ] a\n- [ ] b\n');
        const service = new TaskWriteService(session.index);
        const deleted: string[] = [];
        service.onTaskDeleted(id => deleted.push(id));
        const [a, b] = session.index.getTasks().sort((x, y) => x.line - y.line);

        expect(await service.deleteTask(a.id)).toBe(true);
        const bNow = session.index.getTask(b.id)!;
        expect(await session.index.deleteTask(bNow.id)).toBe(true);

        expect(deleted).toEqual([a.id]);
    });
});

describe('what the end of a drag draws', () => {
    it('draws the note read again once the drag lets go of it, not the copy the drag began on', async () => {
        const { session } = await openQuiet('- [ ] a @2026-10-01\n');
        const heard = listen(session);
        const row = session.index.getTasks()[0];

        session.index.setDraggingFile(NOTE);
        await session.index.updateTask(row.id, { startDate: '2026-10-02' });
        // The write does not change the copy: the note is held.
        expect(session.index.getTask(row.id)?.startDate).toBe('2026-10-01');
        await session.index.setDraggingFile(null);
        expect(session.index.getTasks()[0].startDate).toBe('2026-10-02');
        session.index.notifyImmediate();
        await frame();

        expect(heard).toEqual(['full']);
    });
});
