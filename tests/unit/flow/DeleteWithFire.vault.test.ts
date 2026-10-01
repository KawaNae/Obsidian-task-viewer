import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { freezeDate } from '../helpers/fakeDate';

/**
 * A delete with its fire (`Operations.deleteTask`, `fireFlow`): the flow plans
 * it (`FlowExecutor.planDeletion`), and the operations write it as they write
 * a completion's fire, in one write of the note — the next instance, then the
 * row taken away. A fire that cannot be planned stops the delete, and the user
 * is told why (`FlowNotices.deletionStopped`).
 */

// `every` lands on the first grid point after the later of today and the
// row's date: today is held on the Friday the dates below are read from.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => {
    vi.restoreAllMocks();
    live?.dispose();
    live = undefined;
});

async function open(note: string[]) {
    const { contents, session } = await openVault({ [FILE]: note });
    live = session;
    let processed = 0;
    const vault = session.app.vault as unknown as { process: (...args: unknown[]) => Promise<string> };
    const process = vault.process.bind(vault);
    vault.process = (...args) => { processed++; return process(...args); };
    const id = session.index.getTasks().find(task => task.content === 'A')!.id;
    return { contents, session, id, processed: () => processed };
}

describe('a delete with its fire', () => {
    it('writes the next instance and takes the row away, in one write', async () => {
        const note = await open(['# note', '- [ ] A @2026-09-21 ==> every mon', '\t- [ ] c', '- [ ] B', '']);

        expect(await note.session.ops.deleteTask(note.id, { fireFlow: true })).toBe(true);

        expect(note.contents.get(FILE)).toBe(['# note', '- [ ] A @2026-09-28 ==> every mon', '- [ ] B', ''].join('\n'));
        expect(note.processed()).toBe(1);
        expect(Notice.messages).toEqual([]);
    });

    it('takes the row away alone when the command has nothing left to generate', async () => {
        const note = await open(['# note', '- [ ] A @2026-09-21 ==> every mon until(2026-06-30)', '- [ ] B', '']);

        expect(await note.session.ops.deleteTask(note.id, { fireFlow: true })).toBe(true);

        expect(note.contents.get(FILE)).toBe(['# note', '- [ ] B', ''].join('\n'));
    });

    it('stops when the fire cannot be planned, writes nothing, and says why once while it keeps failing', async () => {
        // 発火できないコマンドは行の上に残っており、その行が消える寸前だった。
        // ここで消すと、残そうとしたものをちょうど失う。
        const lines = ['# note', '- [ ] A @2026-09-21 ==> every mon setDue(end + 1d)', ''];
        const note = await open(lines);

        expect(await note.session.ops.deleteTask(note.id, { fireFlow: true })).toBe(false);
        expect(await note.session.ops.deleteTask(note.id, { fireFlow: true })).toBe(false);

        expect(note.contents.get(FILE)).toBe(lines.join('\n'));
        expect(note.processed()).toBe(0);
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain('the task was not deleted');
    });

    it('answers, rather than throws, when the plan throws', async () => {
        // 待ち手を残したまま返らないと、呼んだメニューがそのまま固まる。
        const lines = ['# note', '- [ ] A @2026-09-21 ==> every mon', ''];
        const note = await open(lines);
        vi.spyOn(FlowExecutor.prototype, 'planDeletion').mockImplementation(() => { throw new Error('disk on fire'); });

        expect(await note.session.ops.deleteTask(note.id, { fireFlow: true })).toBe(false);

        expect(note.contents.get(FILE)).toBe(lines.join('\n'));
    });
});
