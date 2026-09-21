import { describe, it, expect } from 'vitest';
import { writeBench, FILE } from '../helpers/writeBench';
import type { Task } from '../../../src/types';

/**
 * Counterexamples run against F2 (a write names its target and asks
 * `TaskScanner.locate` where it stands).
 *
 * Each case pins the behaviour a write should have. N1, R4 and B1 were found
 * open on F2's first cut and closed in it; X1 is older than F2 (the ladder
 * pairing a stale ledger after our own rename) and stays `it.skip` until the
 * matcher's side takes it up. "Before F2" comments are inferred by reading
 * `FileOperations.findTaskLineNumber` at 0c20c7f4, not run.
 */

const checked = (task: Task): Task => ({ ...task, statusChar: 'x' });

describe('F2-counter: nested rows that read the same', () => {
    // c1 and c2 read the same, under different parents, each with its own child.
    const before = [
        '- [ ] P1',
        '\t- [ ] c',
        '\t\t- [ ] g1',
        '- [ ] P2',
        '\t- [ ] c',
        '\t\t- [ ] g2',
    ];

    it('an external line above: writes c2 by its parent scope, not the first c', async () => {
        // Before F2 (inferred): the stored line no longer reads c, the first
        // exact match is c1 -> wrong line. F2 closed it.
        const bench = await writeBench(before);
        const c2 = bench.taskAt(4);
        bench.edit(['メモ', ...before]);
        await bench.writer.deleteTaskFromFile(c2);
        expect(bench.lines()).toEqual(['メモ', ...before.slice(0, 4)]);
        expect(bench.refused).toEqual([]);
    });

    // SHAPE N1 (F2 writes the wrong line). c2's subtree is moved, from outside,
    // above c1 under P1. In pass 1 the scope of P1 holds [c1] against two `c`
    // rows; nearest ordinal gives c1 the upper one (which is really c2) and c1
    // is marked `guessed`. The lower `c` (really c1) is left over and meets c2
    // in pass 2 as a one-against-one bucket, so c2 is *not* `guessed` and
    // `locate` answers `at` on a line that only position made available.
    // The delete of c2 removes c1 and g1. The next scan (no claim: no state
    // on record) then hands c1's name to the surviving c2 row.
    // Before F2 (inferred): stored line 4 reads g1, the first exact `\t- [ ] c`
    // is line 1, which is c2 -> right by luck. F2 opened this shape.
    // Correct: c2 is refused as ambiguous, since which `c` is which was decided
    // by position.
    it('N1: refuses c2 after its subtree moved above an identical sibling (pass-2 leftover of a positional bucket)', async () => {
        const bench = await writeBench(before);
        const c2 = bench.taskAt(4);
        const moved = [
            '- [ ] P1',
            '\t- [ ] c',
            '\t\t- [ ] g2',
            '\t- [ ] c',
            '\t\t- [ ] g1',
            '- [ ] P2',
        ];
        bench.edit(moved);
        const written = await bench.writer.deleteTaskFromFile(c2);

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(moved);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['ambiguous']);
    });

});

describe('F2-counter: one-against-one leftovers (ladder rung 4)', () => {
    // SHAPE R4 (F2 writes where the old search refused). Undated rows all share
    // the empty date key, so rung 4 pairs any one leftover with any one new row.
    // "buy milk" is replaced from outside by "call mom" (a sync, or a delete and
    // an add in one save). `locate(buy milk)` answers `at` with edited: true,
    // and only the rewrites (update, stripFlow) read `edited`. A delete, an
    // insert-under, a duplicate, an archive take the line.
    // Before F2 (inferred): no ^id, stored line text differs, no exact text,
    // no content match, the loose check on the stored line fails -> -1, refused.
    // F2 opened it. Whether it is wrong depends on whether the user renamed the
    // row or replaced it; the scan calls it the same row (documented price), but
    // the write has `edited` in hand and discards it for destructive writes.
    // Correct (by the contract "rather not write than write the wrong line"):
    // refuse as changed.
    it('R4: refuses to delete a row whose line no record reads (undated rung-4 pairing)', async () => {
        const before = ['- [ ] alpha', '- [ ] buy milk', '- [ ] omega'];
        const bench = await writeBench(before);
        const milk = bench.taskAt(1);
        bench.edit(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        const written = await bench.writer.deleteTaskFromFile(milk);

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('the rewrite on the same shape is refused as changed', async () => {
        const bench = await writeBench(['- [ ] alpha', '- [ ] buy milk', '- [ ] omega']);
        const milk = bench.taskAt(1);
        bench.edit(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        const written = await bench.writer.updateTaskInFile(milk, checked(milk));
        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] alpha', '- [ ] omega', '- [ ] call mom']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    it('a line checked from outside is not rebuilt from the snapshot (rung 3)', async () => {
        // Before F2 (inferred): content + date matched and the line was rebuilt
        // from the snapshot, dropping the outside edit. F2 refuses.
        const bench = await writeBench(['- [ ] A @2026-01-01', '- [ ] B @2026-01-02']);
        const a = bench.taskAt(0);
        bench.edit(['- [x] A @2026-01-01 #tag', '- [ ] B @2026-01-02']);
        const written = await bench.writer.updateTaskInFile(a, { ...a, startDate: '2026-01-05' });
        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [x] A @2026-01-01 #tag', '- [ ] B @2026-01-02']);
    });
});

describe('F2-counter: identical rows', () => {
    const same = ['- [ ] 読書', '- [ ] 読書', '- [ ] other'];

    it('with nothing changed, the ledger tells them apart and the second is written', async () => {
        const bench = await writeBench(same);
        const y = bench.taskAt(1);
        await bench.writer.updateTaskInFile(y, checked(y));
        expect(bench.lines()).toEqual(['- [ ] 読書', '- [x] 読書', '- [ ] other']);
    });

    it('a line inserted above from outside: refused (before F2, inferred: stored line read the first 読書 -> wrong line)', async () => {
        const bench = await writeBench(same);
        const y = bench.taskAt(1);
        bench.edit(['メモ', ...same]);
        const written = await bench.writer.updateTaskInFile(y, checked(y));
        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['メモ', ...same]);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['ambiguous']);
    });

    it('an edit below them from outside: refused although the stored line still reads it (availability, not a wrong line)', async () => {
        // Before F2 (inferred): stored line 1 reads the same text -> written, correctly.
        const bench = await writeBench(same);
        const y = bench.taskAt(1);
        bench.edit(['- [ ] 読書', '- [ ] 読書', '- [ ] other!']);
        const written = await bench.writer.updateTaskInFile(y, checked(y));
        expect(written).toBe(false);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['ambiguous']);
    });

    it('a ^id line copied above from outside: refused (before F2, inferred: stored line -> the copy)', async () => {
        const bench = await writeBench(['- [ ] A ^a']);
        const x = bench.taskAt(0);
        bench.edit(['- [ ] A ^a', '- [ ] A ^a']);
        const written = await bench.writer.updateTaskInFile(x, checked(x));
        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] A ^a', '- [ ] A ^a']);
    });

    it('own duplicate, then a frontmatter write (no claim), then a write on the original: refused', async () => {
        // Before F2 (inferred): stored line shifted by the frontmatter, first
        // exact match is the copy -> wrong line. F2 closed it.
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const a = bench.taskAt(0);
        expect(await bench.cloner.duplicateInlineTask(a)).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] A', '- [ ] A', '- [ ] B']);
        await bench.repo.setFrontmatterKeys(FILE, { color: 'red' });
        expect(bench.lines()[0]).toBe('---');
        const written = await bench.writer.updateTaskInFile(a, checked(a));
        expect(written).toBe(false);
        expect(bench.lines().slice(-3)).toEqual(['- [ ] A', '- [ ] A', '- [ ] B']);
    });

    it('own write, then a frontmatter write, then a write on a unique row: written on the right line', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        const a = bench.taskAt(0);
        const b = bench.taskAt(1);
        await bench.writer.updateTaskInFile(a, checked(a));
        await bench.repo.setFrontmatterKeys(FILE, { color: 'red' });
        const written = await bench.writer.updateTaskInFile(b, checked(b));
        expect(written).toBe(true);
        expect(bench.lines().slice(-2)).toEqual(['- [x] A', '- [x] B']);
    });
});

describe('F2-counter: own writes and outside edits interleaved', () => {
    // SHAPE X1 (wrong line, before and after F2). Our write renames X to Y's
    // text, then Y is deleted from outside before any scan. The stale ledger
    // pairs Y with X's line one-against-one (the claim does not fit the file,
    // so it is not adopted), and X's line reads Y's recorded text, so it is
    // not `edited` either. A write on Y (from a view the scan has not
    // refreshed) lands on X.
    // Before F2 (inferred): the first exact match for Y's text is X's line ->
    // the same wrong line. Not opened by F2.
    // Correct: gone (Y's line was deleted).
    it.skip('X1: a write on a row deleted from outside does not land on the row our own write renamed to its text', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B', '- [ ] C']);
        const x = bench.taskAt(0);
        const y = bench.taskAt(1);
        await bench.writer.updateTaskInFile(x, { ...x, content: 'B', originalText: '- [ ] B' });
        expect(bench.lines()).toEqual(['- [ ] B', '- [ ] B', '- [ ] C']);
        bench.edit(['- [ ] B', '- [ ] C']);
        const written = await bench.writer.updateTaskInFile(y, checked(y));

        expect(written).toBe(false);
        expect(bench.lines()).toEqual(['- [ ] B', '- [ ] C']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['gone']);
    });

    it('a scan that read before the write and committed after it: the next write still finds the second of two identical rows', async () => {
        const bench = await writeBench(['- [ ] 読書', '- [ ] 読書', '- [ ] other']);
        const y = bench.taskAt(1);
        const other = bench.taskAt(2);

        // The scan reads now and resolves only after the write landed.
        const read = bench.app.vault.read;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        bench.app.vault.read = async (file: { path: string }) => {
            const snapshot = bench.contents.get(file.path) ?? '';
            await gate;
            return snapshot;
        };
        const scanning = bench.scan();
        await bench.writer.updateTaskInFile(other, checked(other));
        release();
        await scanning;
        bench.app.vault.read = read;

        const written = await bench.writer.updateTaskInFile(y, checked(y));
        expect(written).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] 読書', '- [x] 読書', '- [x] other']);

        await bench.scan();
        expect(bench.taskAt(1).id).toBe(y.id);
    });
});

describe('F2-counter: ^id', () => {
    // SHAPE B1 (wrong line, before and after F2). The ^id is moved from the
    // task onto a paragraph line from outside, a scan commits (the row's name
    // survives by its text), and a write from a snapshot taken before the scan
    // still carries the ^id. Step 1 takes the one line that carries it, which
    // is not a task line. `edited` catches a rewrite; a delete does not read it.
    // Before F2 (inferred): Strategy -1 is the same code -> same line.
    // Correct: the only line bearing the ^id is not a task line, so it names nothing.
    it('B1: a delete from a stale snapshot does not take the paragraph that now carries the ^id', async () => {
        const bench = await writeBench(['- [ ] A ^a', 'text']);
        const stale = bench.taskAt(0);
        bench.edit(['- [ ] A', 'text ^a']);
        await bench.scan();
        const written = await bench.writer.deleteTaskFromFile(stale);

        // Either the row itself goes (named by the ledger) or nothing does;
        // the paragraph never does.
        expect(bench.lines()).toContain('text ^a');
        if (written) expect(bench.lines()).toEqual(['text ^a']);
    });
});

describe('F2-counter: flow effects', () => {
    const DONE = '- [x] 🍅 記録';
    const TODO = '- [ ] 🍅 記録';
    const FLOW = '\t- ==> every 1d';

    it('create-next then strip-flow on the second of two identical fired records: the right one', async () => {
        // The next instance goes to the head of the sibling group (line 0).
        // Before F2 (inferred): stored line 2 then reads the upper DONE, which
        // equals the fired line's text -> the upper record is stripped (wrong).
        const bench = await writeBench([DONE, FLOW, DONE, FLOW, '']);
        const second = bench.taskAt(2);
        await bench.cloner.insertRecurrenceForTask(second, TODO, ['every 1d']);
        await bench.writer.stripFlow(second);
        expect(bench.lines()).toEqual([TODO, FLOW, DONE, FLOW, DONE, '']);
        expect(bench.refused).toEqual([]);
    });

    it('same-file archive with an identical text, then delete-original: deletes the original, not the archive', async () => {
        const bench = await writeBench(['- [x] A', '- [ ] B']);
        const a = bench.taskAt(0);
        await bench.writer.appendTaskWithChildren(FILE, '- [x] A', a);
        expect(bench.lines()).toEqual(['- [x] A', '- [ ] B', '- [x] A']);
        expect(await bench.writer.deleteTaskFromFile(a)).toBe(true);
        expect(bench.lines()).toEqual(['- [ ] B', '- [x] A']);
    });

    it('same-file archive, a frontmatter write, then delete-original: refused, leaving both (availability)', async () => {
        // Before F2 (inferred): the stored line is shifted, the first exact
        // match is the original (above the archive) -> right by position.
        const bench = await writeBench(['- [x] A', '- [ ] B']);
        const a = bench.taskAt(0);
        await bench.writer.appendTaskWithChildren(FILE, '- [x] A', a);
        await bench.repo.setFrontmatterKeys(FILE, { color: 'red' });
        expect(await bench.writer.deleteTaskFromFile(a)).toBe(false);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['ambiguous']);
    });
});

describe('F2-counter: editor-driven writes', () => {
    it('deleteLine refuses when the disk line no longer reads what the editor showed', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] B']);
        bench.edit(['メモ', '- [ ] A', '- [ ] B']);
        await bench.writer.deleteLine(FILE, { line: 1, text: '- [ ] B' });
        expect(bench.lines()).toEqual(['メモ', '- [ ] A', '- [ ] B']);
        expect(bench.refused.map(r => r.reason.kind)).toEqual(['changed']);
    });

    // The pair (line, text) is all an editor write has. Over identical
    // neighbours it cannot tell a shifted disk from an unshifted one; with no
    // shift it removes the row the user pointed at, and the claim keeps the
    // other two names.
    it('deleteLine over identical neighbours: the pair (line, text) the claim keeps the names of the other two', async () => {
        const bench = await writeBench(['- [ ] A', '- [ ] A', '- [ ] A']);
        const ids = bench.tasks().map(t => t.id);
        // Editor showed three rows; the user deletes line 1 (the middle row).
        await bench.writer.deleteLine(FILE, { line: 1, text: '- [ ] A' });
        await bench.scan();
        expect(bench.tasks().map(t => t.id)).toEqual([ids[0], ids[2]]);
    });
});
