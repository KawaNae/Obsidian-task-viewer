import { describe, it, expect } from 'vitest';
import {
    HintLog, MAX_HINTS_PER_FILE, HINT_TTL_MS,
    resolveHints, type ClaimedRow, type Hint,
} from '../../../../../src/services/core/identity/IdentityHints';
import type { LedgerEntry } from '../../../../../src/services/core/identity/IdentityLedger';
import { fingerprintOf } from '../../../../../src/services/core/identity/IdentityFingerprint';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';

/**
 * The log the plugin's own writes leave behind, and the rule that decides
 * whether a scan may believe any of it.
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

/** One write's claim: the file's rows, as `[runtimeId | null, text]` pairs. */
const claim = (...rows: Array<[string | null, string]>): Hint => ({
    rows: rows.map(([runtimeId, text]): ClaimedRow => ({ runtimeId, text })),
});

const pendingOf = (...hints: Hint[]) => hints.map((hint, i) => ({ seq: i + 1, at: 0, hint }));

describe('HintLog', () => {
    it('keeps one file\'s claims in the order they were raised', () => {
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);
        log.add(FILE, [claim(['r2', B])], 0);

        expect(log.pendingFor(FILE, 0).map(entry => entry.seq)).toEqual([1, 2]);
    });

    it('files each path separately', () => {
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);
        log.add('other.md', [claim(['r2', B])], 0);

        expect(log.pendingFor(FILE, 0)).toHaveLength(1);
        expect(log.pendingFor('other.md', 0)).toHaveLength(1);
    });

    it('drops the whole file past the per-file limit', () => {
        const log = new HintLog();
        for (let i = 0; i <= MAX_HINTS_PER_FILE; i++) {
            log.add(FILE, [claim([`r${i}`, A])], 0);
        }

        expect(log.pendingFor(FILE, 0)).toHaveLength(0);
    });

    it('lets a claim expire, and the file\'s log with it', () => {
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 1_000);
        expect(log.pendingFor(FILE, 1_000 + HINT_TTL_MS - 1)).toHaveLength(1);

        // A claim young enough to stand on its own still goes: what expired
        // beside it may have been the candidate that refused (see below).
        log.add(FILE, [claim(['r2', B])], 1_000 + HINT_TTL_MS - 1);
        expect(log.pendingFor(FILE, 1_000 + HINT_TTL_MS)).toHaveLength(0);
    });

    it('forgets a file on request', () => {
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);

        log.dropFile(FILE);

        expect(log.pendingFor(FILE, 0)).toHaveLength(0);
    });

    it('takes a write\'s claim back when the write failed', () => {
        // A `vault.process` that throws after the callback leaves the file as
        // it was; a claim about it describes a state that never existed.
        const log = new HintLog();
        log.add(FILE, [claim(['kept', A])], 0);
        const withdraw = log.add(FILE, [claim(['gone', B])], 0);

        withdraw();

        expect(log.pendingFor(FILE, 0).map(entry => entry.hint.rows[0].runtimeId)).toEqual(['kept']);
    });

    it('shows the log as it stands, expired entries included', () => {
        // What a console sees has to tell "the write claimed nothing" apart
        // from "the claim aged out before a scan came".
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);

        const seen = log.peek();

        expect(seen).toHaveLength(1);
        expect(seen[0].file).toBe(FILE);
        expect(seen[0].pending[0].hint.rows).toEqual([{ runtimeId: 'r1', text: A }]);
        expect(log.peek()[0].pending).toHaveLength(1);
    });
});

describe('HintLog: dropping a claim must not decide anything', () => {
    // Two claims that reproduce the same lines and disagree about whose they
    // are. Together they refuse; alone, either one would be adopted. So the
    // ways a claim can leave the log quietly — the per-file limit, the age
    // limit — have to take the file's whole log with them, or they turn a
    // refusal into a decision.
    const cOld = claim(['r1', A], ['r2', B]);
    const cNew = claim(['r2', A], ['r1', B]);
    const read = [task(A, 0), task(B, 1)];
    const previous = [row('r1', '- [ ] before', 0), row('r2', '- [ ] also before', 1)];

    it('refuses while both claims are in the log', () => {
        const log = new HintLog();
        log.add(FILE, [cOld], 0);
        log.add(FILE, [cNew], 0);

        expect(resolveHints(previous, read, log.pendingFor(FILE, 0)).consumed).toBe(0);
    });

    it('still refuses when the limit is reached', () => {
        // Filed so that trimming the log to its limit would push the older
        // claim out and leave the newer one standing alone.
        const log = new HintLog();
        log.add(FILE, [cOld], 0);
        for (let i = 0; i < MAX_HINTS_PER_FILE - 1; i++) log.add(FILE, [claim([`r${i}`, A])], 0);
        log.add(FILE, [cNew], 0);

        expect(resolveHints(previous, read, log.pendingFor(FILE, 0)).consumed).toBe(0);
    });

    it('still refuses when the older claim has aged out', () => {
        const log = new HintLog();
        log.add(FILE, [cOld], 0);
        log.add(FILE, [cNew], HINT_TTL_MS - 1);

        expect(resolveHints(previous, read, log.pendingFor(FILE, HINT_TTL_MS)).consumed).toBe(0);
    });
});

describe('HintLog.settle', () => {
    it('retires the claim the scan adopted, and everything older', () => {
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);
        log.add(FILE, [claim(['r1', A_DONE])], 0);
        log.add(FILE, [claim(['r1', B])], 0);

        log.settle(FILE, 2, true);

        expect(log.pendingFor(FILE, 0).map(entry => entry.seq)).toEqual([3]);
    });

    it('keeps a claim the scan did not adopt', () => {
        // The window the design accepts, and now survives: the scan read the
        // file from before the write. Claims do not chain, so this one blocks
        // nothing, and its own scan is still coming.
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);

        log.settle(FILE, 0, false);

        expect(log.pendingFor(FILE, 0)).toHaveLength(1);
    });

    it('drops everything when a scan adopted nothing and still moved the rows', () => {
        // The scan's read already contained the write the claim describes, and
        // the ladder placed it some other way. Believing the claim afterwards
        // would be deciding a file that has already been read.
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);

        log.settle(FILE, 0, true);

        expect(log.pendingFor(FILE, 0)).toHaveLength(0);
    });

    it('lets the next write\'s claim work after one went unadopted', () => {
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);

        log.settle(FILE, 0, false);
        log.add(FILE, [claim(['r2', B])], 0);

        const pending = log.pendingFor(FILE, 0);
        expect(pending).toHaveLength(2);
        expect(pending[1].hint.rows[0].runtimeId).toBe('r2');
    });

    it('retires what has aged out on the way past', () => {
        const log = new HintLog();
        log.add(FILE, [claim(['r1', A])], 0);

        log.settle(FILE, 0, false);

        expect(log.pendingFor(FILE, HINT_TTL_MS)).toHaveLength(0);
    });
});

describe('resolveHints: what the read bears out', () => {
    it('adopts the claim that is, line for line, what was read', () => {
        const previous = [row('r1', A, 0)];
        const duplicated = pendingOf(claim(['r1', A], [null, A]));

        const resolved = resolveHints(previous, [task(A, 0), task(A, 1)], duplicated);

        expect(resolved.consumed).toBe(1);
        expect(resolved.rows).toEqual([
            { runtimeId: 'r1', text: A },
            { runtimeId: null, text: A },
        ]);
    });

    it('adopts nothing while the write has not reached the reader', () => {
        const previous = [row('r1', A, 0)];
        const duplicated = pendingOf(claim(['r1', A], [null, A]));

        expect(resolveHints(previous, [task(A, 0)], duplicated).consumed).toBe(0);
    });

    it('adopts nothing when an external edit arrived in the same scan', () => {
        const previous = [row('r1', A, 0)];
        const duplicated = pendingOf(claim(['r1', A], [null, A]));

        const read = [task(A, 0), task(A, 1), task('- [ ] typed by hand', 2)];
        expect(resolveHints(previous, read, duplicated).consumed).toBe(0);
    });

    it('adopts the newest claim the read bears out', () => {
        // One scan read the file after two writes: the older claim describes a
        // state the file has already left.
        const previous = [row('r1', A, 0)];
        const both = pendingOf(
            claim(['r1', A], [null, A]),
            claim(['r1', A_DONE], [null, A]),
        );

        const resolved = resolveHints(previous, [task(A_DONE, 0), task(A, 1)], both);

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows).toEqual([
            { runtimeId: 'r1', text: A_DONE },
            { runtimeId: null, text: A },
        ]);
    });

    it('adopts the older claim when the read stopped there', () => {
        const previous = [row('r1', A, 0)];
        const both = pendingOf(
            claim(['r1', A], [null, A]),
            claim(['r1', A_DONE], [null, A]),
        );

        expect(resolveHints(previous, [task(A, 0), task(A, 1)], both).consumed).toBe(1);
    });

    it('refuses to hand a row to a line another parser now owns', () => {
        // Turning a third-party notation off leaves the text alone and changes
        // the parser. The ladder never pairs across parsers; neither does this.
        const previous = [row('r1', A, 0)];
        const rewrite = pendingOf(claim(['r1', A_DONE]));

        const read = [task(A_DONE, 0, { parserId: 'tasks-plugin' })];
        expect(resolveHints(previous, read, rewrite).consumed).toBe(0);
    });

    it('refuses a claim that puts one row on two lines', () => {
        // Only a broken writer produces this, and the ladder cannot: it takes
        // each previous row once. Believing it would leave two tasks answering
        // to one runtime ID, and every lookup by that ID finding whichever came
        // first — so the last gate before the ledger checks it.
        const previous = [row('r1', A, 0)];
        const doubled = pendingOf(claim(['r1', A], ['r1', A]));

        const resolved = resolveHints(previous, [task(A, 0), task(A, 1)], doubled);

        expect(resolved.consumed).toBe(0);
        expect(resolved.rows).toBeNull();
    });

    it('refuses a claim built on a generation the ledger has left behind', () => {
        // The row it names is not in `previous` any more, so the claim cannot
        // say whose identity this line carries.
        const previous = [row('r2', A, 0)];
        const stale = pendingOf(claim(['r1', A]));

        expect(resolveHints(previous, [task(A, 0)], stale).consumed).toBe(0);
    });
});

describe('resolveHints: when more than one candidate fits', () => {
    // A file that comes back to a text it already had reads the same both
    // times, so the text cannot say which state was read. What settles it is
    // whether the candidates would decide differently.

    it('adopts a claim that agrees with the state before it', () => {
        // A write that only touched the lines between the tasks: the rows are
        // exactly what they were, so both candidates decide the same thing.
        const previous = [row('r1', A, 0), row('r2', B, 1)];
        const untouchedRows = pendingOf(claim(['r1', A], ['r2', B]));

        const resolved = resolveHints(previous, [task(A, 0), task(B, 1)], untouchedRows);

        expect(resolved.consumed).toBe(1);
        expect(resolved.rows).toEqual([
            { runtimeId: 'r1', text: A },
            { runtimeId: 'r2', text: B },
        ]);
    });

    it('is done with the log up to the newest claim that fits', () => {
        // Two writes that left the rows alone — both claims fit, and so does
        // the state before them. They decide the same thing, so which one is
        // adopted settles nothing about identity; what it settles is how much
        // of the log this scan has finished with.
        const previous = [row('r1', A, 0)];
        const both = pendingOf(claim(['r1', A]), claim(['r1', A]));

        expect(resolveHints(previous, [task(A, 0)], both).consumed).toBe(2);
    });

    it('refuses when a round trip leaves two candidates deciding differently', () => {
        // The write deleted the row and wrote its text again, so the file reads
        // as it did before while the line is a different task. Whether this
        // read is the old file or the new one is a question about *when*, which
        // the reader cannot answer — so the ladder takes it.
        const previous = [row('r1', A, 0)];
        const rewritten = pendingOf(claim([null, A]));

        expect(resolveHints(previous, [task(A, 0)], rewritten).consumed).toBe(0);
    });

    it('refuses when two claims reproduce the read and disagree', () => {
        const previous = [row('r1', A, 0)];
        const pending = pendingOf(
            claim(['r1', A], [null, B]),
            claim([null, A], ['r1', B]),
        );

        expect(resolveHints(previous, [task(A, 0), task(B, 1)], pending).consumed).toBe(0);
    });

    it('is not confused by a claim from a write that landed elsewhere', () => {
        // Two writes to one file, the second describing rows the first never
        // produced: only one of them can be what was read.
        const previous = [row('a', A, 0), row('b', B, 1)];
        const pending = pendingOf(
            claim(['a', A_DONE], ['b', B]),
            claim(['a', A], ['b', B], [null, B]),
        );

        const resolved = resolveHints(previous, [task(A_DONE, 0), task(B, 1)], pending);

        expect(resolved.consumed).toBe(1);
        expect(resolved.rows?.[0]).toEqual({ runtimeId: 'a', text: A_DONE });
    });
});

describe('resolveHints: the shapes a position-based match got wrong', () => {
    // Each of these was answered incorrectly when claims were matched to lines
    // by the line number the write recorded, and again when they were replayed
    // as per-line edits. A claim that carries the whole row list has no
    // position to be wrong about.

    it('follows two rewrites of one row through a text a sibling also has', () => {
        // A goes d1 → d2 → d3 while B sits at d2 the whole time.
        const previous = [row('a', '- [ ] foo @d1', 0), row('b', '- [ ] foo @d2', 1)];
        const chained = pendingOf(
            claim(['a', '- [ ] foo @d2'], ['b', '- [ ] foo @d2']),
            claim(['a', '- [ ] foo @d3'], ['b', '- [ ] foo @d2']),
        );

        const resolved = resolveHints(
            previous,
            [task('- [ ] foo @d3', 0), task('- [ ] foo @d2', 1)],
            chained,
        );

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows).toEqual([
            { runtimeId: 'a', text: '- [ ] foo @d3' },
            { runtimeId: 'b', text: '- [ ] foo @d2' },
        ]);
    });

    it('retires the row the write retired, not its twin', () => {
        const previous = [row('a', '- [ ] foo @d1', 0), row('b', '- [ ] foo @d2', 1)];
        const pending = pendingOf(
            claim(['a', '- [ ] foo @d2'], ['b', '- [ ] foo @d2']),
            claim(['b', '- [ ] foo @d2']),
        );

        const resolved = resolveHints(previous, [task('- [ ] foo @d2', 0)], pending);

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows).toEqual([{ runtimeId: 'b', text: '- [ ] foo @d2' }]);
    });

    it('is unmoved by a retire above the line it inserted', () => {
        const previous = [row('z', '- [ ] gone @d0', 0), row('a', '- [ ] T @d1', 5)];
        const pending = pendingOf(
            claim(['z', '- [ ] gone @d0'], [null, '- [ ] T @d1'], ['a', '- [ ] T @d1']),
            claim([null, '- [ ] T @d1'], ['a', '- [ ] T @d1']),
        );

        const resolved = resolveHints(
            previous,
            [task('- [ ] T @d1', 4), task('- [ ] T @d1', 5)],
            pending,
        );

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows).toEqual([
            { runtimeId: null, text: '- [ ] T @d1' },
            { runtimeId: 'a', text: '- [ ] T @d1' },
        ]);
    });

    it('keeps the original\'s identity when the same task is duplicated twice', () => {
        const previous = [row('a', '- [ ] T @d1', 0)];
        const twice = pendingOf(
            claim(['a', '- [ ] T @d1'], [null, '- [ ] T @d1']),
            claim(['a', '- [ ] T @d1'], [null, '- [ ] T @d1'], [null, '- [ ] T @d1']),
        );

        const resolved = resolveHints(
            previous,
            [task('- [ ] T @d1', 0), task('- [ ] T @d1', 1), task('- [ ] T @d1', 2)],
            twice,
        );

        expect(resolved.consumed).toBe(2);
        expect(resolved.rows?.[0]).toEqual({ runtimeId: 'a', text: '- [ ] T @d1' });
        expect(resolved.rows?.slice(1).every(claimed => claimed.runtimeId === null)).toBe(true);
    });

    it('does not let a claim about one part of the file answer for another', () => {
        // The first write never landed; the second duplicated B, far away. The
        // stale claim puts the new line next to A, which is not the file that
        // was read — and it does not reproduce it, so it is not in the running.
        const previous = [row('a', '- [ ] T @d1', 0), row('b', '- [ ] T @d1', 19)];
        const pending = pendingOf(
            claim(['a', '- [ ] T @d1'], [null, '- [ ] T @d1'], ['b', '- [ ] T @d1']),
            claim(['a', '- [ ] T @d1'], ['b', '- [ ] T @d1'], [null, '- [ ] T @d1']),
        );

        const resolved = resolveHints(
            previous,
            [task('- [ ] T @d1', 0), task('- [ ] T @d1', 19), task('- [ ] T @d1', 20)],
            pending,
        );

        // Both claims have three identically worded lines, so both reproduce
        // the read — and they disagree about which line is B's. Neither counts.
        expect(resolved.consumed).toBe(0);
        expect(resolved.rows).toBeNull();
    });
});
