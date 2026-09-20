import type { Task } from '../../../types';
import type { LedgerEntry } from './IdentityLedger';

/**
 * What the plugin's own writes tell the next scan about which line is which.
 *
 * A hint is a claim, not an instruction: "after this write, the file's task
 * rows read like this" — checked against what the scan actually read before it
 * is believed. A missing hint costs precision and nothing else, because the
 * ladder in IdentityMatcher exists for external edits anyway. A *wrong* hint
 * would be worse than none, so belief is all-or-nothing: either a claim
 * reproduces the rows that were read, or it does not count.
 *
 * A claim is absolute — the whole row list, not an edit to be applied to
 * something. Two earlier designs said it the other way round: first as a
 * multiset of line texts matched up by the line number each write recorded,
 * then as an ordered list of per-line edits (rewrite/insert/retire) replayed
 * over the previous rows. Both made the *reader* reconstruct a state the
 * *writer* already knew, and both paid for it — the first with a position that
 * a later write in the same batch made stale, the second with anchors, with
 * replay order, and with a prefix of one write's edits describing a file that
 * never existed. The writer knows the answer; letting it say the answer is
 * shorter than any scheme for re-deriving it.
 *
 * Hints are raised inside the `vault.process` callback, which is the only place
 * where the written text is settled and the `modify` event has not fired yet —
 * a hint raised after the `await` is too late for the scan that write triggers
 * (measured: the scan's read starts before `vault.process` resolves).
 */

/** One task row of a file, as a write claims it reads. */
export interface ClaimedRow {
    /** The row that carries this line's identity, or null if the write made it. */
    runtimeId: string | null;
    text: string;
}

/** What one write claims the file's task rows are, once it has landed. */
export interface Hint {
    rows: ClaimedRow[];
}

export interface PendingHint {
    /** Monotonic across the whole log. Also orders one file's hints. */
    seq: number;
    /** When it was raised, for the age limit. */
    at: number;
    hint: Hint;
}

export interface HintResolution {
    /**
     * How many hints, counted from the head, this scan has finished with — the
     * adopted claim and everything older. 0 when nothing was adopted.
     */
    consumed: number;
    /** The adopted claim's rows, one per line read, or null when none was. */
    rows: ClaimedRow[] | null;
}

/**
 * How many claims one file may hold.
 *
 * Lower than the per-line vocabulary's limit, because an entry is now a whole
 * file's rows rather than one line's claim. A read lagging eight writes behind
 * is past anything measured; what this exists for is a file nobody scans again,
 * which must not grow without bound.
 */
export const MAX_HINTS_PER_FILE = 16;

/**
 * How long an unadopted claim may wait. Far above anything normal — a write's
 * own scan reads within milliseconds. What this catches is the case where no
 * scan is coming at all (a write made while a drag suppresses scans for that
 * file). An expired claim costs precision, never correctness.
 */
export const HINT_TTL_MS = 30_000;

/**
 * Per-file ordered log of pending claims.
 *
 * The clock is the caller's: `now` comes in as a parameter so the log stays
 * testable and pure. So is the scan's reading position — see `tip`.
 */
export class HintLog {
    private readonly files = new Map<string, PendingHint[]>();
    private seq = 0;

    /**
     * File a write's claims, and answer a handle that takes them back.
     *
     * The handle is for a write that raised its claims and then failed — a
     * `vault.process` that throws after the callback returns leaves the file
     * as it was, and claims about a write that never happened must not sit in
     * the log waiting to be matched against something else.
     */
    add(file: string, hints: readonly Hint[], now: number): () => void {
        if (hints.length === 0) return () => {};

        const pending = this.files.get(file) ?? [];
        const filed: number[] = [];
        for (const hint of hints) {
            const seq = ++this.seq;
            filed.push(seq);
            pending.push({ seq, at: now, hint });
        }

        // Past the limit the file's whole log goes, this write's claim with it.
        // Dropping the oldest few would be worse than dropping all: a claim is
        // adopted only when no other candidate decides differently, so the
        // candidate that would have refused is exactly the one whose absence
        // lets a wrong one through. Trimming a log turns a refusal into a
        // decision, which is the one direction this mechanism may not move in.
        if (pending.length > MAX_HINTS_PER_FILE) {
            this.files.delete(file);
            return () => {};
        }
        this.files.set(file, pending);

        const withdrawn = new Set(filed);
        return () => {
            const current = this.files.get(file);
            if (!current) return;
            this.store(file, current.filter(entry => !withdrawn.has(entry.seq)));
        };
    }

    /**
     * This file's claims in the order they were raised, minus anything expired.
     *
     * All of them, with no cut for where the scan's read fell. A cut was tried:
     * the log position taken around the read, so that a claim filed afterwards
     * could not be weighed. It draws no line that holds. A scan is synchronous
     * from its read to its match, so nothing is filed in between; and a write
     * whose callback runs in the gap before the scan resumes lands on either
     * side of such a mark depending on where it is taken. Position cannot say
     * which state was read — only the rows can, which is what
     * {@link resolveHints} asks them.
     */
    pendingFor(file: string, now: number): PendingHint[] {
        const pending = this.files.get(file);
        if (!pending) return [];

        // One expired claim takes the file's log with it, for the reason the
        // limit does (see `add`): the candidate that would have refused must
        // not be the one that quietly disappears. Expiry is all here, so
        // {@link settle} never has to think about it.
        if (pending.some(entry => now - entry.at >= HINT_TTL_MS)) {
            this.files.delete(file);
            return [];
        }
        return pending;
    }

    /**
     * Retire what this scan finished with, and what it has now made unusable.
     *
     * @param consumed how many claims from the head are done with — the adopted
     *   one and everything older, which describe states the file has moved past.
     * @param ledgerMoved whether this scan changed the file's rows. A scan that
     *   adopted nothing and still moved the ledger absorbed something it could
     *   not account for — including, possibly, the very writes the pending
     *   claims describe, which the ladder then placed its own way. Believing
     *   those claims later would be believing them about a file that has
     *   already been read some other way, so the whole log goes. What that
     *   costs is precision on the next write.
     *
     * A claim that simply did not match is kept. Claims do not chain, so a
     * pending one blocks nothing behind it, and the usual reason it did not
     * match is that its write has not reached this reader yet: a scan whose
     * read started before the write landed reads the file as it was, commits
     * that, and the write's own scan follows. Dropping it there would throw
     * away a claim about the very next read. What that leaves open is a hand
     * edit landing, in those milliseconds, on exactly the lines the pending
     * claim describes — accepted, and narrow enough to say so in one line.
     */
    settle(file: string, consumed: number, ledgerMoved: boolean): void {
        const pending = this.files.get(file);
        if (!pending) return;

        if (consumed === 0 && ledgerMoved) {
            this.files.delete(file);
            return;
        }

        this.store(file, pending.slice(consumed));
    }

    /**
     * Forget a file's claims.
     *
     * Also what a rename does. A claim names runtime IDs, and a rename rewrites
     * them (the ID still carries the path until stage 3), so carrying the log
     * across would leave claims about rows that no longer answer to those
     * names: they would fail to match and cost the file its next claim anyway.
     * Dropping them says the same thing in one line.
     */
    dropFile(file: string): void {
        this.files.delete(file);
    }

    clear(): void {
        this.files.clear();
    }

    /**
     * Every file's pending claims, for a console or a check that needs to see
     * what the write layer said.
     *
     * Does not prune: a caller looking at the log has to see it as it is,
     * expired entries included, or it cannot tell "the write claimed nothing"
     * from "the claim aged out before a scan came".
     *
     * @internal Read-only use.
     */
    peek(): Array<{ file: string; pending: readonly PendingHint[] }> {
        return [...this.files].map(([file, pending]) => ({ file, pending: [...pending] }));
    }

    private store(file: string, pending: PendingHint[]): void {
        if (pending.length === 0) this.files.delete(file);
        else this.files.set(file, pending);
    }
}

/**
 * Pick the claim that describes what this scan read, if exactly one answer is
 * on offer.
 *
 * Every pending claim is a candidate, and so is the previous scan's own rows —
 * the file may simply not have changed yet, which is what a read that started
 * before a write landed sees. A candidate is in the running when its rows are,
 * line for line and in order, the rows that were read.
 *
 * Two candidates can be in the running at once, because a file that comes back
 * to a text it already had reads the same both times. Text does not settle it,
 * and nothing else here can: which of them is true is a question about when the
 * read happened, which the reader cannot answer. So the claims are compared by
 * what they would actually decide — the runtime ID of each row. Candidates that
 * decide the same thing are not in conflict whatever their texts did on the way
 * (a write that only touched lines between the tasks leaves the rows exactly as
 * they were, and matching both itself and the state before it changes nothing).
 * Candidates that decide differently are a coin toss, and a coin toss is the one
 * thing this mechanism must never do: the ladder takes it from there.
 *
 * The newest surviving candidate is the one adopted, so the log can drop what
 * the file has moved past.
 */
export function resolveHints(
    previous: LedgerEntry[],
    tasks: Task[],
    pending: readonly PendingHint[],
): HintResolution {
    if (pending.length === 0) return { consumed: 0, rows: null };

    const byRuntimeId = new Map(previous.map(entry => [entry.runtimeId, entry]));

    // The state before any of these writes. In the running like the rest, but
    // never adopted: it claims nothing the ladder does not already work out
    // from rows it can match verbatim. Its part is to disagree.
    const unchanged: ClaimedRow[] = previous.map(entry => ({
        runtimeId: entry.runtimeId,
        text: entry.fingerprint.originalText,
    }));

    // Index 0 is the state before the writes; index i + 1 is the file as the
    // i-th pending claim describes it. The index doubles as how much of the log
    // the file has moved past once that candidate is adopted.
    const candidates: ClaimedRow[][] = [unchanged, ...pending.map(entry => entry.hint.rows)];

    let decision: string | null = null;
    let consumed = 0;
    let rows: ClaimedRow[] | null = null;

    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        if (!reproduces(candidate, tasks, byRuntimeId)) continue;

        const verdict = decisionOf(candidate);
        if (decision === null) decision = verdict;
        else if (decision !== verdict) return { consumed: 0, rows: null };

        // The newest that fits. Every candidate still standing at this point
        // decides the same thing, so which one is adopted changes no identity —
        // only how much of the log this scan is done with. A claim that fits
        // the current read while describing a write still to come describes one
        // that leaves the rows exactly as they are, which the next scan does
        // not need told.
        if (index > 0) {
            consumed = index;
            rows = candidate;
        }
    }

    return { consumed, rows };
}

/** What a candidate would decide: the identity of each row, in order. */
function decisionOf(rows: ClaimedRow[]): string {
    return JSON.stringify(rows.map(row => row.runtimeId));
}

/** True when the candidate is, line for line, the rows that were read. */
function reproduces(
    rows: ClaimedRow[],
    tasks: Task[],
    byRuntimeId: Map<string, LedgerEntry>,
): boolean {
    if (rows.length !== tasks.length) return false;

    const spoken = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
        if (rows[i].text !== tasks[i].originalText) return false;

        const runtimeId = rows[i].runtimeId;
        if (runtimeId === null) continue;
        // One row, one line. A claim that puts the same identity on two lines
        // is a claim no file can bear out, and believing it would leave two
        // tasks answering to one name — the ledger would hold the number twice
        // and every lookup by it would find whichever came first. The ladder
        // cannot produce this state (it takes each previous row once), so this
        // is the only door it could come through.
        if (spoken.has(runtimeId)) return false;
        spoken.add(runtimeId);
        // Never across parsers, the rule every rung of the ladder follows.
        // Turning a third-party notation off can leave the text identical and
        // the parser different. A row the ledger no longer holds fails here
        // too: the claim was built on a generation this scan has left behind.
        const entry = byRuntimeId.get(runtimeId);
        if (!entry || entry.fingerprint.parserId !== tasks[i].parserId) return false;
    }

    return true;
}
