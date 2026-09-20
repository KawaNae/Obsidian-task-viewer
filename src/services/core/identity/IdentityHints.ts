import type { Task } from '../../../types';
import type { LedgerEntry } from './IdentityLedger';

/**
 * What the plugin's own writes tell the next scan about which line is which.
 *
 * A hint is a claim, not an instruction: "after this write, the file holds one
 * more line reading T" — checked against what the scan actually read before it
 * is believed. A missing hint costs precision and nothing else, because the
 * ladder in IdentityMatcher exists for external edits anyway. A *wrong* hint
 * would be worse than none, so every one of them is verified first.
 *
 * Hints are raised inside the `vault.process` callback, which is the only place
 * where the line positions and the written text are both settled and where the
 * `modify` event has not fired yet — a hint raised after the `await` is too late
 * for the scan that write triggers (measured: the scan's read starts before
 * `vault.process` resolves).
 */
export type Hint =
    | { kind: 'rewrite'; runtimeId: string; before: string; after: string; line: number }
    | { kind: 'insert'; text: string; line: number }
    | { kind: 'retire'; runtimeId: string; text: string };

export interface PendingHint {
    /** Monotonic across the whole log. Also orders one file's hints. */
    seq: number;
    /** When it was raised, for the age limit. */
    at: number;
    hint: Hint;
}

/**
 * How many hints one file may hold. A single flow fire raises a handful; this
 * is three orders above that, and exists so a file nobody scans again cannot
 * grow without bound.
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

    add(file: string, hint: Hint, now: number): void {
        const pending = this.files.get(file) ?? [];
        pending.push({ seq: ++this.seq, at: now, hint });

        // Oldest first, so what survives is what a coming scan is most likely
        // to be able to verify.
        if (pending.length > MAX_HINTS_PER_FILE) {
            pending.splice(0, pending.length - MAX_HINTS_PER_FILE);
        }
        this.files.set(file, pending);
    }

    /**
     * The highest seq this file holds right now.
     *
     * A scan takes this immediately before its `vault.read` and hands it back
     * when it commits. Everything at or below it was raised before the read, so
     * whatever the read saw is now in the ledger and those hints have had their
     * one chance. Without that line, a hint that failed verification once (an
     * external edit landing in the same scan, say) would keep failing forever:
     * the ledger has moved on, so the expected state it is built from no longer
     * matches, and it would block every hint behind it until it aged out.
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
     */
    settle(file: string, consumed: number, readTip: number, now: number): void {
        const pending = this.files.get(file);
        if (!pending) return;

        const kept = pending
            .slice(consumed)
            .filter(entry => entry.seq > readTip && now - entry.at < HINT_TTL_MS);
        this.store(file, kept);
    }

    /** Forget a file's hints (deleted, renamed away, or newly `tv-ignore`d). */
    dropFile(file: string): void {
        this.files.delete(file);
    }

    /** Move a file's hints to its new path, so a rename does not strand them. */
    rekeyFile(oldPath: string, newPath: string): void {
        const pending = this.files.get(oldPath);
        this.files.delete(oldPath);
        this.files.delete(newPath);
        if (pending && pending.length > 0) this.files.set(newPath, pending);
    }

    clear(): void {
        this.files.clear();
    }

    private store(file: string, pending: PendingHint[]): void {
        if (pending.length === 0) this.files.delete(file);
        else this.files.set(file, pending);
    }
}

/** A multiset of line texts: what the file says, with positions thrown away. */
export type TextBag = Map<string, number>;

function shift(bag: TextBag, text: string, by: number): void {
    const next = (bag.get(text) ?? 0) + by;
    if (next === 0) bag.delete(text);
    else bag.set(text, next);
}

export function bagOfEntries(entries: LedgerEntry[]): TextBag {
    const bag: TextBag = new Map();
    for (const entry of entries) shift(bag, entry.fingerprint.originalText, 1);
    return bag;
}

export function bagOfTasks(tasks: Task[]): TextBag {
    const bag: TextBag = new Map();
    for (const task of tasks) shift(bag, task.originalText, 1);
    return bag;
}

/** Apply one hint's claim to the expected bag, in place. */
export function applyHintToBag(bag: TextBag, hint: Hint): void {
    switch (hint.kind) {
        case 'rewrite':
            shift(bag, hint.before, -1);
            shift(bag, hint.after, 1);
            return;
        case 'insert':
            shift(bag, hint.text, 1);
            return;
        case 'retire':
            shift(bag, hint.text, -1);
            return;
    }
}

function bagsEqual(a: TextBag, b: TextBag): boolean {
    if (a.size !== b.size) return false;
    for (const [text, count] of a) {
        if (b.get(text) !== count) return false;
    }
    return true;
}

/**
 * How many hints from the head of the log this scan may believe.
 *
 * The test is a count, not a lookup. "Is there a line reading T?" cannot verify
 * an insert, because duplication — the write these hints exist for — inserts a
 * line reading exactly what the line beside it already reads, so the answer is
 * yes before the write as well as after. What separates the two is *how many*
 * such lines there are.
 *
 * So: start from the previous scan's texts, apply the pending hints one at a
 * time, and answer with the largest k whose expected bag equals what was
 * actually read. k = 0 means the read predates every pending hint (or an
 * external edit arrived in the same scan) and nothing is believed. A scan that
 * read two writes' worth of changes verifies both, which is why this walks the
 * whole log rather than stopping at the first mismatch: the two are the same
 * question asked of a different number of hints.
 */
export function consumableHintCount(
    previous: LedgerEntry[],
    tasks: Task[],
    pending: readonly PendingHint[],
): number {
    if (pending.length === 0) return 0;

    const actual = bagOfTasks(tasks);
    const expected = bagOfEntries(previous);

    let believed = 0;
    for (let k = 1; k <= pending.length; k++) {
        applyHintToBag(expected, pending[k - 1].hint);
        if (bagsEqual(expected, actual)) believed = k;
    }
    return believed;
}
