import { describe, it, expect } from 'vitest';
import type { ClaimedRow } from '../../../../../src/services/core/identity/IdentityHints';
import { matchFile, type MatchResult } from '../../../../../src/services/core/identity/IdentityMatcher';
import { rowsOnlyReading, type RecordOf } from '../../../helpers/rowsOnlyEvidence';
import type { LedgerEntry } from '../../../../../src/services/core/identity/IdentityLedger';
import { fingerprintOf } from '../../../../../src/services/core/identity/IdentityFingerprint';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';

/**
 * The records the plugin's own writes leave behind, and the rule that decides
 * whether a scan may believe any of them.
 */

const FILE = 'note.md';

function task(text: string, line: number, extra: Partial<Task> = {}): Task {
    return makeTask({
        file: FILE, line, originalText: text,
        content: text.replace(/^- \[.\] /, ''),
        ...extra,
    });
}

function row(runtimeId: string, text: string, line: number, extra: Partial<Task> = {}): LedgerEntry {
    return {
        runtimeId,
        file: FILE,
        parent: null,
        ordinal: line,
        fingerprint: fingerprintOf(task(text, line, extra)),
    };
}

const A = '- [ ] alpha @2026-09-21';
const B = '- [ ] beta @2026-09-21';
const A_DONE = '- [x] alpha @2026-09-21';

/**
 * One write's record: the file's rows, as `[runtimeId | null, text]` pairs.
 *
 * A null id is a row the write made. Such a row still has a name — the write
 * coins one when it makes the line — so what null says here is "any name, as
 * long as it is this row's own". Where a test needs two records to agree on
 * that name, as two writes in one chain do, it says the name with {@link made}.
 */
let coined = 0;

const claim = (...rows: Array<[string | null, string]>): RecordOf => ({
    rows: rows.map(([runtimeId, text]): ClaimedRow => runtimeId === null
        ? { runtimeId: `w${++coined}`, created: true, text }
        : { runtimeId, created: false, text }),
});

/** A row a write made, under the name it gave it. */
const made = (runtimeId: string, text: string): ClaimedRow => ({ runtimeId, created: true, text });

/**
 * The matcher, weighing records about a file made only of its rows (see
 * rowsOnlyReading). A row no reading names gets `m1`, `m2`, … in file order.
 */
const resolve = (previous: LedgerEntry[], tasks: Task[], records: readonly RecordOf[]): MatchResult => {
    let minted = 0;
    return matchFile(previous, tasks, () => `m${++minted}`, rowsOnlyReading(previous, tasks, records));
};

/** The names the rows carry, in file order. */
const names = (result: MatchResult): string[] => result.entries.map(entry => entry.runtimeId);

describe('two records that disagree must not decide anything', () => {
    // Two records that reproduce the same lines and disagree about whose they
    // are. Together they refuse; alone, either one would be adopted.
    const cOld = claim(['r1', A], ['r2', B]);
    const cNew = claim(['r2', A], ['r1', B]);
    const read = [task(A, 0), task(B, 1)];
    const previous = [row('r1', '- [ ] before', 0), row('r2', '- [ ] also before', 1)];

    it('refuses while both records are held', () => {
        const result = resolve(previous, read, [cOld, cNew]);

        expect(names(result)).toEqual(['m1', 'm2']);
        expect([...result.disputed].sort()).toEqual(['r1', 'r2']);
    });
});

describe('resolve: what the read bears out', () => {
    it('adopts the record that is, line for line, what was read', () => {
        const previous = [row('r1', A, 0)];
        const duplicated: RecordOf = { rows: [{ runtimeId: 'r1', created: false, text: A }, made('n1', A)] };

        const result = resolve(previous, [task(A, 0), task(A, 1)], [duplicated]);

        expect(names(result)).toEqual(['r1', 'n1']);
        expect(result.minted).toEqual(['n1']);
    });

    it('adopts nothing while the write has not reached the reader', () => {
        const previous = [row('r1', A, 0)];
        const duplicated = claim(['r1', A], [null, A]);

        const result = resolve(previous, [task(A, 0)], [duplicated]);

        expect(names(result)).toEqual(['r1']);
        expect(result.minted).toEqual([]);
    });

    it('adopts nothing when an external edit arrived in the same scan', () => {
        const previous = [row('r1', A, 0)];
        const duplicated = claim(['r1', A], [null, A]);

        const read = [task(A, 0), task(A, 1), task('- [ ] typed by hand', 2)];
        expect(names(resolve(previous, read, [duplicated]))).toEqual(['r1', 'm1', 'm2']);
    });

    it('adopts the newest record the read bears out', () => {
        // One scan read the file after two writes: the older record describes a
        // state the file has already left.
        const previous = [row('r1', A, 0)];
        // The copy keeps one name across both records, as a second write
        // building on the first one's base would leave it.
        const both: RecordOf[] = [
            { rows: [{ runtimeId: 'r1', created: false, text: A }, made('n1', A)] },
            { rows: [{ runtimeId: 'r1', created: false, text: A_DONE }, made('n1', A)] },
        ];

        const result = resolve(previous, [task(A_DONE, 0), task(A, 1)], both);

        expect(names(result)).toEqual(['r1', 'n1']);
        expect(result.minted).toEqual(['n1']);
    });

    it('adopts the older record when the read stopped there', () => {
        const previous = [row('r1', A, 0)];
        const older = claim(['r1', A], [null, A]);
        const both = [older, claim(['r1', A_DONE], [null, A])];

        expect(names(resolve(previous, [task(A, 0), task(A, 1)], both)))
            .toEqual(['r1', older.rows[1].runtimeId]);
    });

    it('refuses to hand a row to a line another parser now owns', () => {
        // Turning a third-party notation off leaves the text alone and changes
        // the parser. The ladder never pairs across parsers; neither does this.
        const previous = [row('r1', A, 0)];
        const rewrite = claim(['r1', A_DONE]);

        const read = [task(A_DONE, 0, { parserId: 'tasks-plugin' })];
        expect(names(resolve(previous, read, [rewrite]))).toEqual(['m1']);
    });

    it('refuses a record that gives one made row two lines', () => {
        // A name the write coined is checked like any other. The ledger has
        // never heard it, so nothing downstream would notice the collision —
        // both lines would be committed under it, and every lookup by it would
        // find whichever came first.
        const previous = [row('r1', A, 0)];
        const doubled: RecordOf = { rows: [made('n1', A), made('n1', A)] };

        expect(names(resolve(previous, [task(A, 0), task(A, 1)], [doubled]))).toEqual(['r1', 'm1']);
    });

    it('refuses a record that puts one row on two lines', () => {
        // Only a broken writer produces this, and the ladder cannot: it takes
        // each previous row once. Believing it would leave two tasks answering
        // to one runtime ID, and every lookup by that ID finding whichever came
        // first — so the last gate before the ledger checks it.
        const previous = [row('r1', A, 0)];
        const doubled = claim(['r1', A], ['r1', A]);

        expect(names(resolve(previous, [task(A, 0), task(A, 1)], [doubled]))).toEqual(['r1', 'm1']);
    });

    it('refuses a record built on a generation the ledger has left behind', () => {
        // The row it names is not in `previous` any more, so the record cannot
        // say whose identity this line carries.
        const previous = [row('r2', A, 0)];
        const stale = claim(['r1', A]);

        expect(names(resolve(previous, [task(A, 0)], [stale]))).toEqual(['r2']);
    });
});

describe('resolve: when more than one state fits', () => {
    // A file that comes back to a text it already had reads the same both
    // times, so the text cannot say which state was read. What settles it is
    // whether the states would decide differently.

    it('adopts a record that agrees with the state before it', () => {
        // A write that only touched the lines between the tasks: the rows are
        // exactly what they were, so both states decide the same thing.
        const previous = [row('r1', A, 0), row('r2', B, 1)];
        const untouchedRows = claim(['r1', A], ['r2', B]);

        const result = resolve(previous, [task(A, 0), task(B, 1)], [untouchedRows]);

        expect(names(result)).toEqual(['r1', 'r2']);
        expect(result.disputed.size).toBe(0);
    });

    it('keeps the name every fitting state agrees on', () => {
        // Two writes that left the rows alone — both records fit, and so does
        // the state before them. They decide the same thing.
        const previous = [row('r1', A, 0)];
        const both = [claim(['r1', A]), claim(['r1', A])];

        const result = resolve(previous, [task(A, 0)], both);

        expect(names(result)).toEqual(['r1']);
        expect(result.disputed.size).toBe(0);
    });

    it('refuses when a round trip leaves two states deciding differently', () => {
        // The write deleted the row and wrote its text again, so the file reads
        // as it did before while the line is a different task. Whether this
        // read is the old file or the new one is a question about *when*, which
        // the reader cannot answer.
        const previous = [row('r1', A, 0)];
        const rewritten = claim([null, A]);

        const result = resolve(previous, [task(A, 0)], [rewritten]);

        // I1: two readings name the row differently, so it is new (was: the ladder gave it r1).
        expect(names(result)).toEqual(['m1']);
        expect([...result.disputed].sort()).toEqual(['r1', rewritten.rows[0].runtimeId].sort());
    });

    it('refuses when two records reproduce the read and disagree', () => {
        const previous = [row('r1', A, 0)];
        const records = [
            claim(['r1', A], [null, B]),
            claim([null, A], ['r1', B]),
        ];

        // I1: both rows are named differently by the two readings, so both are new (was: the ladder gave the first r1).
        expect(names(resolve(previous, [task(A, 0), task(B, 1)], records))).toEqual(['m1', 'm2']);
    });

    it('is not confused by a record from a write that landed elsewhere', () => {
        // Two writes to one file, the second describing rows the first never
        // produced: only one of them can be what was read.
        const previous = [row('a', A, 0), row('b', B, 1)];
        const records = [
            claim(['a', A_DONE], ['b', B]),
            claim(['a', A], ['b', B], [null, B]),
        ];

        expect(names(resolve(previous, [task(A_DONE, 0), task(B, 1)], records))).toEqual(['a', 'b']);
    });
});

describe('resolve: the shapes a position-based match got wrong', () => {
    // Each of these was answered incorrectly when claims were matched to lines
    // by the line number the write recorded, and again when they were replayed
    // as per-line edits. A record that carries the whole row list has no
    // position to be wrong about.

    it('follows two rewrites of one row through a text a sibling also has', () => {
        // A goes d1 → d2 → d3 while B sits at d2 the whole time.
        const previous = [row('a', '- [ ] foo @d1', 0), row('b', '- [ ] foo @d2', 1)];
        const chained = [
            claim(['a', '- [ ] foo @d2'], ['b', '- [ ] foo @d2']),
            claim(['a', '- [ ] foo @d3'], ['b', '- [ ] foo @d2']),
        ];

        const result = resolve(
            previous,
            [task('- [ ] foo @d3', 0), task('- [ ] foo @d2', 1)],
            chained,
        );

        expect(names(result)).toEqual(['a', 'b']);
    });

    it('retires the row the write retired, not its twin', () => {
        const previous = [row('a', '- [ ] foo @d1', 0), row('b', '- [ ] foo @d2', 1)];
        const records = [
            claim(['a', '- [ ] foo @d2'], ['b', '- [ ] foo @d2']),
            claim(['b', '- [ ] foo @d2']),
        ];

        const result = resolve(previous, [task('- [ ] foo @d2', 0)], records);

        expect(names(result)).toEqual(['b']);
        expect(result.retired).toEqual(['a']);
    });

    it('is unmoved by a retire above the line it inserted', () => {
        const previous = [row('z', '- [ ] gone @d0', 0), row('a', '- [ ] T @d1', 5)];
        const records: RecordOf[] = [
            { rows: [{ runtimeId: 'z', created: false, text: '- [ ] gone @d0' }, made('n1', '- [ ] T @d1'), { runtimeId: 'a', created: false, text: '- [ ] T @d1' }] },
            { rows: [made('n1', '- [ ] T @d1'), { runtimeId: 'a', created: false, text: '- [ ] T @d1' }] },
        ];

        const result = resolve(
            previous,
            [task('- [ ] T @d1', 4), task('- [ ] T @d1', 5)],
            records,
        );

        expect(names(result)).toEqual(['n1', 'a']);
    });

    it('keeps the original\'s identity when the same task is duplicated twice', () => {
        const previous = [row('a', '- [ ] T @d1', 0)];
        const newer = claim(['a', '- [ ] T @d1'], [null, '- [ ] T @d1'], [null, '- [ ] T @d1']);
        const twice = [
            claim(['a', '- [ ] T @d1'], [null, '- [ ] T @d1']),
            newer,
        ];

        const result = resolve(
            previous,
            [task('- [ ] T @d1', 0), task('- [ ] T @d1', 1), task('- [ ] T @d1', 2)],
            twice,
        );

        // Two copies, two names: one name on two lines is a record no file can
        // bear out, and `reproduces` would refuse the whole thing.
        expect(names(result)).toEqual(['a', newer.rows[1].runtimeId, newer.rows[2].runtimeId]);
        expect(new Set(names(result)).size).toBe(3);
    });

    it('does not let a record about one part of the file answer for another', () => {
        // The first write never landed; the second duplicated B, far away. The
        // stale record puts the new line next to A, which is not the file that
        // was read — yet it reproduces it all the same.
        const previous = [row('a', '- [ ] T @d1', 0), row('b', '- [ ] T @d1', 19)];
        const records = [
            claim(['a', '- [ ] T @d1'], [null, '- [ ] T @d1'], ['b', '- [ ] T @d1']),
            claim(['a', '- [ ] T @d1'], ['b', '- [ ] T @d1'], [null, '- [ ] T @d1']),
        ];

        const result = resolve(
            previous,
            [task('- [ ] T @d1', 0), task('- [ ] T @d1', 19), task('- [ ] T @d1', 20)],
            records,
        );

        // Both records have three identically worded lines, so both reproduce
        // the read — and they disagree about which line is B's.
        // I1: the rows they agree on keep their name, the disputed two are new (was: nothing adopted, the ladder gave a, b and a new name).
        expect(names(result)).toEqual(['a', 'm1', 'm2']);
        expect(result.disputed.has('b')).toBe(true);
    });
});
