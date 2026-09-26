import { describe, it, expect, vi, afterEach } from 'vitest';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { editLines, replayEdits, type EditedLines } from '../../../src/utils/FileLines';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import type { TaskOp } from '../../../src/services/persistence/TaskOps';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { freezeDate } from '../helpers/fakeDate';

freezeDate(new Date(2026, 8, 25, 12, 0, 0));

/**
 * One attempt of a write (`editLines`) reads the lines it was handed once
 * (`Outline.read`), for the plan's check (`readsAsPlanned`), the places it
 * asks of `Placement` and the write's check (`checkWrite`); the draft reads
 * its lines again only once an op has changed them (`LineDraft.reading`).
 *
 * What is pinned: a write of several ops, each asking `Placement` or the
 * outline after the ops before it changed the lines, writes what those ops
 * write one attempt each; and an update reads the lines once before and once
 * after.
 *
 * Only the move and the property lines ask `Placement` past a change that
 * reads apart from the lines as handed; a reading kept past a change fails
 * those two. The completion and the record ask it after a rewrite of the row
 * alone, which reads as the row did, and a next instance's place is read at
 * and above the row, where the update's property lines never go: they pin
 * that the shared reading answers as before, not that it is dropped.
 */

const FILE = 'note.md';

afterEach(() => { vi.restoreAllMocks(); });

/** The ops applied to the row on `line`, in one attempt. */
function together(session: VaultSession, lines: readonly string[], line: number, ops: readonly TaskOp[]): EditedLines {
    const host = session.index.editorFireHost();
    return editLines(FILE, lines, '\n', (draft, _eol, s) =>
        host.applyOps(draft, s, { line, text: lines[line], key: contentKeyOf(lines) }, ops));
}

/** The same ops, one attempt each, the row followed across each. */
function oneByOne(session: VaultSession, lines: readonly string[], line: number, ops: readonly TaskOp[]): readonly string[] | null {
    let now = lines;
    let at = line;
    for (const op of ops) {
        const edited = together(session, now, at, [op]);
        if (!edited.written) return null;
        at = replayEdits(now.length, edited.edits)!.origin.indexOf(at);
        now = edited.lines;
    }
    return now;
}

function fire(session: VaultSession): TaskOp {
    return session.index.editorFireHost().fireOp(FILE).op;
}

async function sameEitherWay(note: string[], line: number, ops: (session: VaultSession) => TaskOp[]): Promise<readonly string[]> {
    const { session } = await openVault({ [FILE]: note });
    try {
        const shared = together(session, note, line, ops(session));
        const apart = oneByOne(session, note, line, ops(session));
        expect(shared.written).toBe(true);
        if (!shared.written) throw new Error('not written');
        expect(shared.lines).toEqual(apart);
        return shared.lines;
    } finally {
        session.dispose();
    }
}

describe('a write of several ops, read once while its lines are as handed', () => {
    it('fires a completion (update, next instance, the command taken off) as op by op', async () => {
        const note = ['# note', '- [ ] 週報 @2026-09-21 ==> every mon', '\t- [ ] 子', '- [ ] 下', ''];
        const lines = await sameEitherWay(note, 1, (s) => [{ kind: 'update', text: '- [x] 週報 @2026-09-21 ==> every mon' }, fire(s)]);
        expect(lines).toEqual(['# note', '- [ ] 週報 @2026-09-28 ==> every mon', '- [x] 週報 @2026-09-21', '\t- [ ] 子', '- [ ] 下', '']);
    });

    it('puts a record under a row whose ^id it rewrites first, as op by op', async () => {
        const note = ['# note', '- [ ] T', '\t- [ ] c', '- [ ] U', ''];
        const lines = await sameEitherWay(note, 1, () => [
            { kind: 'update', text: '- [ ] T ^tv-t-1' },
            { kind: 'insert', place: 'firstChild', text: '- [x] rec' },
        ]);
        expect(lines).toEqual(['# note', '- [ ] T ^tv-t-1', '\t- [x] rec', '\t- [ ] c', '- [ ] U', '']);
    });

    it('moves a completed row to a heading below the next instance it put, as op by op', async () => {
        // The next instance goes above the row, so the heading the move
        // asks for stands a line further down than in the lines as handed.
        const note = ['# note', '- [ ] T @2026-09-21 ==> +1d move([[#Done]])', '\t- [ ] c', '- [ ] U', '## Done', '- [x] old', ''];
        const lines = await sameEitherWay(note, 1, (s) => [{ kind: 'update', text: '- [x] T @2026-09-21 ==> +1d move([[#Done]])' }, fire(s)]);
        expect(lines).toEqual(['# note', '- [ ] T @2026-09-22 ==> +1d move([[#Done]])', '- [ ] U', '## Done', '- [x] old', '- [x] T @2026-09-21', '\t- [ ] c', '']);
    });

    it('puts a second property line below the first it put, as op by op', async () => {
        const note = ['# note', '- [ ] T', '\t- [ ] c', '- [ ] U', ''];
        const lines = await sameEitherWay(note, 1, () => [{
            kind: 'update', text: '- [ ] T',
            childOps: [{ key: 'tv-color', op: 'set', value: 'ff0000' }, { key: 'tv-mask', op: 'set', value: 'x' }],
        }]);
        expect(lines.indexOf('\t- tv-color:: ff0000')).toBeLessThan(lines.indexOf('\t- tv-mask:: x'));
    });
});

describe('an update of a long note', () => {
    it('reads the lines once before the write and once after, and the index takes in the one after', async () => {
        const note = ['# note', ...Array.from({ length: 3000 }, (_, i) => `- [ ] row ${i}`), ''];
        const { session } = await openVault({ [FILE]: note });
        try {
            const row = session.index.getTasks().find(t => t.content === 'row 1500')!;
            const read = vi.spyOn(Outline, 'read');
            // The scan the write's `modify` starts is held until the write
            // has landed: it then reads what the index already holds, and
            // reads no outline.
            const scans = session.holdScans();
            expect(await session.index.updateTask(row.id, { content: 'row 1500 renamed' })).toBe(true);
            await scans.release();
            await session.settle(FILE);
            const long = read.mock.calls.filter(([lines]) => lines.length > 3000);
            expect(long).toHaveLength(2);
            expect(long[0][0][1501]).toBe('- [ ] row 1500');
            expect(long[1][0][1501]).toBe('- [ ] row 1500 renamed');
        } finally {
            session.dispose();
        }
    });
});
