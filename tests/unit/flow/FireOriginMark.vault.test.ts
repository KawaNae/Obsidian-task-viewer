import { describe, it, expect, vi } from 'vitest';
import { vaultSession } from '../helpers/vaultSession';
import type { Task } from '../../../src/types';

/**
 * A write of ours that cannot say what it did leaves a mark, not a claim
 * (`WriteClaims`): its base is a content no record describes. A completion
 * such a write made still has to answer for the user (F6, the director's
 * review): a card's check on one row, built on a file a sync had changed on
 * another row and no scan had read yet.
 */

const FILE = 'note.md';

function open(lines: string[]) {
    const contents = new Map([[FILE, lines.join('\n')]]);
    const session = vaultSession(contents);
    const executor = (session.index as unknown as {
        commandExecutor: { handleTaskCompletion: (task: Task) => Promise<void>; isProcessing: boolean };
    }).commandExecutor;
    const fired: string[] = [];
    const original = executor.handleTaskCompletion.bind(executor);
    executor.handleTaskCompletion = (task: Task) => { fired.push(task.content); return original(task); };
    const settled = async () => {
        await vi.waitFor(() => expect(executor.isProcessing).toBe(false));
        await session.settle(FILE);
        await vi.waitFor(() => expect(executor.isProcessing).toBe(false));
    };
    return { contents, session, fired, settled, idOf: (c: string) => session.index.getTasks().find(t => t.content === c)!.id };
}

describe('a completion made by a write that could only leave a mark', () => {
    it('fires when a sync changed another row before any scan read it', async () => {
        const note = open(['# note', '- [ ] 甲 @2026-09-21 ==> every mon', '- [ ] 乙', '']);
        await note.session.scanAll();
        // The sync lands with no modify heard yet: nothing has read it.
        note.contents.set(FILE, ['# note', '- [ ] 甲 @2026-09-21 ==> every mon', '- [ ] 乙 synced', ''].join('\n'));
        expect(await note.session.index.updateTask(note.idOf('甲'), { statusChar: 'x' })).toBe(true);
        await note.settled();
        expect(note.fired).toEqual(['甲']);
    });
});
