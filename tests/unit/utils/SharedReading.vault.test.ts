import { describe, it, expect, vi, afterEach } from 'vitest';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { editLines, replayEdits, type EditedLines } from '../../../src/services/persistence/FileLines';
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

/**
 * Every write of a long note reads its lines as handed once: whatever an op
 * asks of the outline before it has changed the lines — the row's subtree,
 * its `==>` lines, the indentation of a child — it asks of the draft's
 * reading (`LineDraft.reading`), not of a reading of its own. Past that, the
 * write reads the lines it leaves once (`checkWrite`); and a place that is
 * settled by trying the new line there (`Placement.settle`) reads the lines
 * with the line tried in, which are other lines, once.
 */
describe('a write of one op to a long note', () => {
    const ROWS = Array.from({ length: 3000 }, (_, i) => `- [ ] row ${i}`);
    // Row 1500 (line 1501) has a child and a command below it.
    const NOTE = ['# note', ...ROWS.slice(0, 1500), '- [ ] T @2026-09-21', '\t- [ ] c', '\t- ==> every mon', ...ROWS.slice(1500), ''];
    const T = 1501;

    /** How many readings of the whole note `write` makes: of the note as it was handed, and in all. */
    async function readingsOf(write: (session: VaultSession) => Promise<unknown>): Promise<{ handed: number; all: number }> {
        const { session } = await openVault({ [FILE]: NOTE });
        try {
            const read = vi.spyOn(Outline, 'read');
            const scans = session.holdScans();
            await write(session);
            await scans.release();
            await session.settle(FILE);
            const long = read.mock.calls.map(([lines]) => lines).filter(lines => lines.length > 3000);
            const handed = long.filter(lines => lines.length === NOTE.length && lines.every((line, i) => line === NOTE[i]));
            return { handed: handed.length, all: long.length };
        } finally {
            session.dispose();
        }
    }

    const idOf = (session: VaultSession, content: string) => session.index.getTasks().find(t => t.content === content)!.id;

    it('moves a row with its subtree', async () => {
        const readings = await readingsOf(async (session) => {
            const edited = together(session, NOTE, T, [{ kind: 'move', text: '- [x] T @2026-09-21', to: { kind: 'end' } }]);
            expect(edited.written).toBe(true);
        });
        expect(readings).toEqual({ handed: 1, all: 2 });
    });

    it('removes a row with its subtree', async () => {
        const readings = await readingsOf(async (session) => {
            expect(await session.index.deleteTask(idOf(session, 'T'))).toBe(true);
        });
        expect(readings).toEqual({ handed: 1, all: 2 });
    });

    it('duplicates a row with its subtree', async () => {
        const readings = await readingsOf(async (session) => {
            expect(await session.index.duplicateTask(idOf(session, 'T'), { dayOffset: 1 })).toBe(true);
        });
        expect(readings).toEqual({ handed: 1, all: 3 });
    });

    it('puts a first child under a row that has none', async () => {
        const readings = await readingsOf(async (session) => {
            expect(await session.index.insertLine(idOf(session, 'row 1600'), '- [ ] new', 'firstChild')).toBe(true);
        });
        expect(readings).toEqual({ handed: 1, all: 3 });
    });

    it('puts a next instance, its command indented as the row\'s', async () => {
        const readings = await readingsOf(async (session) => {
            const edited = together(session, NOTE, T, [{
                kind: 'insert-instance', insert: { kind: 'recurrence', content: '- [ ] T @2026-09-28', flowLines: ['every mon'] },
            }]);
            expect(edited.written).toBe(true);
        });
        expect(readings).toEqual({ handed: 1, all: 3 });
    });

    it('takes a row\'s command off', async () => {
        const readings = await readingsOf(async (session) => {
            const edited = together(session, NOTE, T, [{ kind: 'strip-flow', text: '- [x] T @2026-09-21' }]);
            expect(edited.written).toBe(true);
        });
        expect(readings).toEqual({ handed: 1, all: 2 });
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
