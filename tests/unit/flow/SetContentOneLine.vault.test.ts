import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';

/**
 * A flow's `set content` that yields several lines stops the fire with a
 * reason (stage F5, found by its counterexample run).
 *
 * The write refuses a line with a break in it (`LineBreakInLine`) and says so
 * only in the log: it is the input's place to refuse, where it can say why.
 * Before F5 the line was written split in two; with the write's check alone
 * the fire did nothing and nobody was told.
 */

const FILE = 'note.md';
let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function open(lines: string[]): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    return openLiveVault(lines, session => { live = session; });
}

describe('set content with a line break in its value', () => {
    it('stops a completion fire with a notice, the command left in place', async () => {
        const note = ['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d setContent("x\\ny")', ''];
        const { contents, session } = await open(note);
        const task = session.index.getTasks().find(t => t.content === 'A')!;

        // The completion is written; its fire is not, and says why.
        expect(await session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
        await session.settle(FILE);

        expect(contents.get(FILE)).toBe(note.join('\n').replace('- [ ] A', '- [x] A'));
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain('several lines');
    });

    it('stops a deletion fire with a notice, the task left in place', async () => {
        const note = ['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d setContent("x\\ny")', ''];
        const { contents, session } = await open(note);
        const id = session.index.getTasks().find(t => t.content === 'A')!.id;

        expect(await session.index.deleteTask(id, { fireFlow: true })).toBe(false);

        expect(contents.get(FILE)).toBe(note.join('\n'));
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain('several lines');
    });
});
