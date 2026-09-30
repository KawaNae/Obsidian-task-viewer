import { describe, it, expect, afterEach } from 'vitest';
import { openLiveVault, type VaultSession } from '../../helpers/vaultSession';

/**
 * A rewrite of the row an anchor names (`Operations.updateByAnchor`): looked
 * up in a reading of the note as the disk holds it, and written by the name
 * that answers, as a timer writes its lines.
 */

const NOTE = 'note.md';
let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

describe('Operations.updateByAnchor', () => {
    it('writes the row the anchor names, and answers the copy it found', async () => {
        const { contents, session } = await openLiveVault(['- [ ] a ^tv-t-1', '- [ ] b', ''], s => { live = s; });

        const out = await session.ops.updateByAnchor(NOTE, 'tv-t-1', { statusChar: 'x' });

        expect(out).toMatchObject({ kind: 'written', task: { content: 'a' } });
        expect(contents.get(NOTE)).toBe(['- [x] a ^tv-t-1', '- [ ] b', ''].join('\n'));
        // The name the copy carries is followed to the row as the write left it.
        if (out.kind === 'written') expect(session.index.getTask(out.task.id)?.statusChar).toBe('x');
    });

    it('makes what it writes from the copy the write is planned from', async () => {
        const { contents, session } = await openLiveVault(['- [ ] a ^tv-t-1', ''], s => { live = s; });

        const out = await session.ops.updateByAnchor(NOTE, 'tv-t-1', row => ({ content: `${row.content}!` }));

        expect(out.kind).toBe('written');
        expect(contents.get(NOTE)).toBe(['- [ ] a! ^tv-t-1', ''].join('\n'));
    });

    it('finds the row after an edit from outside it was never told of', async () => {
        const { contents, session } = await openLiveVault(['- [ ] a ^tv-t-1', ''], s => { live = s; });
        // Changed on the disk; no change event comes.
        contents.set(NOTE, ['- [ ] new', '- [ ] a ^tv-t-1', ''].join('\n'));

        const out = await session.ops.updateByAnchor(NOTE, 'tv-t-1', { statusChar: 'x' });

        expect(out.kind).toBe('written');
        expect(contents.get(NOTE)).toBe(['- [ ] new', '- [x] a ^tv-t-1', ''].join('\n'));
    });

    it('answers none when no row carries the anchor, and writes nothing', async () => {
        const { contents, session } = await openLiveVault(['- [ ] a', ''], s => { live = s; });

        expect(await session.ops.updateByAnchor(NOTE, 'tv-t-1', { statusChar: 'x' })).toEqual({ kind: 'none' });
        expect(contents.get(NOTE)).toBe(['- [ ] a', ''].join('\n'));
    });

    it('answers unreadable when the note cannot be read', async () => {
        const { session } = await openLiveVault(['- [ ] a ^tv-t-1', ''], s => { live = s; });
        (session.app.vault as unknown as { read: () => Promise<string> }).read = () => Promise.reject(new Error('EBUSY'));

        expect(await session.ops.updateByAnchor(NOTE, 'tv-t-1', { statusChar: 'x' })).toEqual({ kind: 'unreadable' });
    });
});
