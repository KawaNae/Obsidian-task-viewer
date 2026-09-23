import type { Fingerprint } from './IdentityFingerprint';
import type { ContentKey } from './ContentKey';

/**
 * What the ledger remembers about one task from the previous scan.
 *
 * Not the task itself — `TaskStore` owns that. The ledger only answers "what
 * number did this row have last time", so the truth has exactly one owner still.
 *
 * `parent` and `ordinal` exist for the matcher: `parent` lets the previous side
 * be grouped into the same scopes as the current side, and `ordinal` breaks ties
 * inside a bucket of identical siblings. `ordinal` is *never* an identity key —
 * treating it as one would be `ln:` under a new name.
 */
export interface LedgerEntry {
    runtimeId: string;
    file: string;
    /** Runtime ID of the parent, or null for a scope root. */
    parent: string | null;
    /** 0-based position among siblings in the same scope, in file order. */
    ordinal: number;
    /**
     * The 0-based line the last scan read this row on.
     *
     * A coordinate in the content the last scan read, and good only there: it
     * is used as a coordinate when the lines in hand are that content, whole
     * (the key the ledger keeps for the file, see `contentFor`), and not
     * otherwise. That is how a write's claim builds on it (see
     * `WriteClaims.stateFor`) and how a write's target is found without a
     * parse (see `TaskScanner.locate`). Never an identity key: the matcher
     * does not look at it at all.
     */
    line: number;
    fingerprint: Fingerprint;
}

/**
 * Session-lived map of `runtimeId → LedgerEntry`, plus the `file → runtimeId[]`
 * reverse index in appearance order.
 *
 * Updates are per file and wholesale: a scan replaces a file's rows in one call
 * so that the ledger and the store commit in the same batch and can never
 * disagree about which generation they are on. Nothing here is persisted —
 * runtime IDs do not survive a restart by design.
 */
export class IdentityLedger {
    private readonly entries = new Map<string, LedgerEntry>();
    private readonly files = new Map<string, string[]>();
    /**
     * Per file, the key of the content the last scan read.
     *
     * Kept for every file a scan committed, rows or none, so that "the ledger
     * has no record" means only one thing: no scan has read this file yet. A
     * file with no rows is a state like any other, and the first task a write
     * adds to it is built on that state.
     */
    private readonly contents = new Map<string, ContentKey>();
    /**
     * Per file, the rows the last scan paired by position (see
     * `MatchResult.guessed`), with how many rows each was one of. Written with
     * the rows, by the scan that committed them, and gone with them.
     */
    private readonly guesses = new Map<string, ReadonlyMap<string, number>>();
    private counter: number;

    /**
     * @param seed Numbers are handed out from `seed + 1`. The scanner seeds from
     *   the clock so that a number never repeats across sessions (see TaskScanner).
     */
    constructor(seed = 0) {
        this.counter = seed;
    }

    /** Previous rows of a file, in the order they were stored (file order). */
    snapshotFor(file: string): LedgerEntry[] {
        const ids = this.files.get(file);
        if (!ids) return [];

        const result: LedgerEntry[] = [];
        for (const id of ids) {
            const entry = this.entries.get(id);
            if (entry) result.push(entry);
        }
        return result;
    }

    /**
     * The key of the content the last scan of this file read, or null when no
     * scan has committed it (never read, dropped, or `tv-ignore`d).
     */
    contentFor(file: string): ContentKey | null {
        return this.contents.get(file) ?? null;
    }

    /**
     * The rows the last scan of this file paired by position — which line
     * each of those names is on is a guess among rows that read alike. Kept
     * past the scan's commit for whoever must know, after the fact, that a
     * row's name was a guess (the firing of a guessed row is stage X's to
     * decide). A write's `locate` does not refuse on it: every read of a note
     * with two rows that read alike guesses them, and refusing would leave
     * those rows unwritable from a card for as long as the note is edited.
     */
    guessedFor(file: string): ReadonlyMap<string, number> {
        return this.guesses.get(file) ?? new Map();
    }

    /**
     * Swap a file's rows wholesale, and record which content they were read
     * from and which of them position decided. Pass the new rows in file order.
     */
    replaceFile(
        file: string,
        entries: LedgerEntry[],
        content: ContentKey,
        guessed: ReadonlyMap<string, number> = new Map(),
    ): void {
        this.dropFile(file);
        this.contents.set(file, content);
        const names = new Set(entries.map(entry => entry.runtimeId));
        const kept = new Map([...guessed].filter(([runtimeId]) => names.has(runtimeId)));
        if (kept.size > 0) this.guesses.set(file, kept);
        if (entries.length === 0) return;

        const ids: string[] = [];
        for (const entry of entries) {
            this.entries.set(entry.runtimeId, entry);
            ids.push(entry.runtimeId);
        }
        this.files.set(file, ids);
    }

    /** Forget a file entirely (deleted, or newly `tv-ignore`d). */
    dropFile(file: string): void {
        this.contents.delete(file);
        this.guesses.delete(file);
        const ids = this.files.get(file);
        if (!ids) return;

        for (const id of ids) {
            this.entries.delete(id);
        }
        this.files.delete(file);
    }

    /**
     * Carry a file's rows across a rename.
     *
     * Without this every task in a renamed file would be newly minted, and every
     * open hub and running timer would lose its target at once. `rewriteId` is the
     * caller's business: while the runtime ID still embeds the path it rewrites the
     * path part, and once IDs are opaque it is the identity function.
     */
    rekeyFile(oldPath: string, newPath: string, rewriteId: (id: string) => string): void {
        const previous = this.snapshotFor(oldPath);
        // The content travels even without rows: a rename does not change
        // what the file reads.
        const content = this.contentFor(oldPath);
        if (content === null) return;
        const guessed = this.guessedFor(oldPath);

        this.dropFile(oldPath);
        // A rename onto an occupied path makes the rows already there stale.
        if (newPath !== oldPath) this.dropFile(newPath);

        const rekeyed = previous.map(entry => ({
            runtimeId: rewriteId(entry.runtimeId),
            file: newPath,
            parent: entry.parent === null ? null : rewriteId(entry.parent),
            line: entry.line,
            ordinal: entry.ordinal,
            fingerprint: entry.fingerprint,
        }));
        this.replaceFile(newPath, rekeyed, content, new Map([...guessed].map(([id, among]) => [rewriteId(id), among])));
    }

    get(runtimeId: string): LedgerEntry | undefined {
        return this.entries.get(runtimeId);
    }

    /** Next sequence number. Monotonic, starting at `seed + 1`. */
    mint(): number {
        return ++this.counter;
    }

    /**
     * Drop everything. The counter keeps climbing on purpose: a number handed out
     * before the reset must never come back and name a different task.
     */
    clear(): void {
        this.entries.clear();
        this.files.clear();
        this.contents.clear();
        this.guesses.clear();
    }
}
