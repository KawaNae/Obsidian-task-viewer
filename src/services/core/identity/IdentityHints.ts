import type { Task } from '../../../types';
import type { LedgerEntry } from './IdentityLedger';

/**
 * What the plugin's own writes tell the next scan about which line is which.
 *
 * A hint is a claim, not an instruction: "after this write, the file reads like
 * this" — checked against what the scan actually read before it is believed. A
 * missing hint costs precision and nothing else, because the ladder in
 * IdentityMatcher exists for external edits anyway. A *wrong* hint would be
 * worse than none, so belief is all-or-nothing: either the claims reproduce the
 * file exactly, or none of them count and the ladder answers.
 *
 * Positions are given relative to a row the writer already knows by runtime ID,
 * never as line numbers. A line number is stale the moment another write in the
 * same batch shifts it, and a hint that points a line off by one is exactly the
 * kind of confident wrong answer this mechanism must not produce.
 *
 * Hints are raised inside the `vault.process` callback, which is the only place
 * where the written text is settled and the `modify` event has not fired yet —
 * a hint raised after the `await` is too late for the scan that write triggers
 * (measured: the scan's read starts before `vault.process` resolves).
 */
export type Hint =
    /** The row `runtimeId` read `before` and now reads `after`. */
    | { kind: 'rewrite'; runtimeId: string; before: string; after: string }
    /** A line the write created, placed next to a row it already knew. */
    | { kind: 'insert'; text: string; anchor: string; side: 'before' | 'after' }
    /** The row `runtimeId` is gone from the file. */
    | { kind: 'retire'; runtimeId: string };

export interface PendingHint {
    /** Monotonic across the whole log. Also orders one file's hints. */
    seq: number;
    /** When it was raised, for the age limit. */
    at: number;
    hint: Hint;
}

/** One line of the file as the pending hints describe it. */
export interface ClaimedRow {
    /** The row that carries this line's identity, or null if a write made it. */
    runtimeId: string | null;
    text: string;
}

export interface HintResolution {
    /** How many hints, counted from the head, the file bore out. */
    consumed: number;
    /** The believed claims, one per line read, or null when nothing is believed. */
    rows: ClaimedRow[] | null;
}

/**
 * How many hints one file may hold. A single flow fire raises a handful; this
 * is well above that, and exists so a file nobody scans again cannot grow
 * without bound.
 */
export const MAX_HINTS_PER_FILE = 64;

/**
 * How long an unconsumed hint may wait. Also far above anything normal — a
 * write's own scan reads within milliseconds. What this catches is the case
 * where no scan is coming at all (a write made while a drag suppresses scans
 * for that file). An expired hint costs precision, never correctness.
 */
export const HINT_TTL_MS = 30_000;

/**
 * Per-file ordered log of pending hints.
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

        // Oldest first, so what survives is what a coming scan is most likely
        // to be able to verify.
        if (pending.length > MAX_HINTS_PER_FILE) {
            pending.splice(0, pending.length - MAX_HINTS_PER_FILE);
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
     * The highest seq this file holds right now.
     *
     * A scan takes this immediately before its `vault.read` and hands it back
     * when it commits. Everything at or below it was raised before the read, so
     * whatever the read saw is now in the ledger and those hints have had their
     * one chance. Without that line, a hint that failed verification once (an
     * external edit landing in the same scan, say) would keep failing forever:
     * the ledger has moved on, so the state it is built from no longer matches,
     * and it would block every hint behind it until it aged out.
     *
     * One window stays open. A hint is raised inside the write callback, a
     * millisecond or two before the file reaches disk, so a scan that starts in
     * between takes a tip *above* that hint while reading text from *before*
     * it. The hint then verifies against nothing, and the commit drops it; the
     * write's own scan, arriving next, finds no hint and falls to the ladder.
     * That is the behaviour without hints at all — the mechanism loses, it does
     * not lie.
     */
    tip(file: string): number {
        const pending = this.files.get(file);
        return pending && pending.length > 0 ? pending[pending.length - 1].seq : this.seq;
    }

    /** This file's hints in the order they were raised, minus anything expired. */
    pendingFor(file: string, now: number): PendingHint[] {
        const pending = this.files.get(file);
        if (!pending) return [];

        const alive = pending.filter(entry => now - entry.at < HINT_TTL_MS);
        if (alive.length !== pending.length) this.store(file, alive);
        return alive;
    }

    /**
     * Retire what this scan used up, and what it has now made unusable.
     *
     * @param consumed how many hints from the head were believed.
     * @param readTip the log position taken before the scan's read; unconsumed
     *   hints at or below it are dropped (see {@link tip}).
     * @param ledgerMoved whether this scan changed the file's rows. A scan that
     *   believed nothing and still moved the ledger absorbed something it could
     *   not account for — including, possibly, the very writes the pending
     *   hints describe, which the ladder then placed its own way. Replaying
     *   those claims over the new rows would be replaying them twice, so the
     *   whole log goes. What that costs is precision on the next write.
     */
    settle(file: string, consumed: number, readTip: number, now: number, ledgerMoved: boolean): void {
        const pending = this.files.get(file);
        if (!pending) return;

        if (consumed === 0 && ledgerMoved) {
            this.files.delete(file);
            return;
        }

        const kept = pending
            .slice(consumed)
            .filter(entry => entry.seq > readTip && now - entry.at < HINT_TTL_MS);
        this.store(file, kept);
    }

    /**
     * Forget a file's hints.
     *
     * Also what a rename does. A hint names runtime IDs, and a rename rewrites
     * them (the ID still carries the path until stage 3), so carrying the log
     * across would leave claims about rows that no longer answer to those
     * names: they would fail to apply and cost the file its next hint anyway.
     * Dropping them says the same thing in one line.
     */
    dropFile(file: string): void {
        this.files.delete(file);
    }

    clear(): void {
        this.files.clear();
    }

    private store(file: string, pending: PendingHint[]): void {
        if (pending.length === 0) this.files.delete(file);
        else this.files.set(file, pending);
    }
}

/**
 * Replay the pending hints over the previous scan's rows and answer how far the
 * file bears them out.
 *
 * The replay is what makes the answer unambiguous. An earlier design tested the
 * *count* of each line's text and then matched claims to lines by the line
 * number each write recorded; that reads the file correctly and still pairs the
 * wrong rows, because two writes to the same row leave an intermediate text
 * that a different row may also carry, and because an insert or a retire moves
 * every line the later hints recorded. Rebuilding the whole file instead
 * removes the question: if the rebuilt lines are exactly the lines read, in
 * order, then each line's identity is whatever the rebuild put there.
 *
 * A hint that cannot be applied — its row is gone, or it claims the row read
 * something it did not — stops the replay. Everything after it describes a file
 * this one never produced.
 */
export function resolveHints(
    previous: LedgerEntry[],
    tasks: Task[],
    pending: readonly PendingHint[],
): HintResolution {
    if (pending.length === 0) return { consumed: 0, rows: null };

    const byRuntimeId = new Map(previous.map(entry => [entry.runtimeId, entry]));
    let rows: ClaimedRow[] = previous.map(entry => ({
        runtimeId: entry.runtimeId,
        text: entry.fingerprint.originalText,
    }));

    let consumed = 0;
    let believed: ClaimedRow[] | null = null;

    for (let k = 1; k <= pending.length; k++) {
        const next = applyHint(rows, pending[k - 1].hint);
        if (next === null) break;
        rows = next;
        if (reproduces(rows, tasks, byRuntimeId)) {
            consumed = k;
            believed = rows;
        }
    }

    return { consumed, rows: believed };
}

/** Apply one claim, or answer null when the file it describes cannot exist. */
function applyHint(rows: ClaimedRow[], hint: Hint): ClaimedRow[] | null {
    switch (hint.kind) {
        case 'rewrite': {
            const at = rows.findIndex(row => row.runtimeId === hint.runtimeId);
            // The `before` check keeps a hint honest about the row it names: a
            // claim whose starting text is not what that row holds is about
            // some other state of the file.
            if (at < 0 || rows[at].text !== hint.before) return null;
            const next = [...rows];
            next[at] = { runtimeId: hint.runtimeId, text: hint.after };
            return next;
        }
        case 'insert': {
            const at = rows.findIndex(row => row.runtimeId === hint.anchor);
            if (at < 0) return null;
            const next = [...rows];
            next.splice(hint.side === 'before' ? at : at + 1, 0, { runtimeId: null, text: hint.text });
            return next;
        }
        case 'retire': {
            const at = rows.findIndex(row => row.runtimeId === hint.runtimeId);
            if (at < 0) return null;
            return rows.filter((_, index) => index !== at);
        }
    }
}

/** True when the rebuilt file is, line for line, the file that was read. */
function reproduces(
    rows: ClaimedRow[],
    tasks: Task[],
    byRuntimeId: Map<string, LedgerEntry>,
): boolean {
    if (rows.length !== tasks.length) return false;

    for (let i = 0; i < rows.length; i++) {
        if (rows[i].text !== tasks[i].originalText) return false;

        const runtimeId = rows[i].runtimeId;
        if (runtimeId === null) continue;
        // Never across parsers, the rule every rung of the ladder follows.
        // Turning a third-party notation off can leave the text identical and
        // the parser different.
        const entry = byRuntimeId.get(runtimeId);
        if (!entry || entry.fingerprint.parserId !== tasks[i].parserId) return false;
    }

    return true;
}
