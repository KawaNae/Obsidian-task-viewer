import type { Fingerprint } from './IdentityFingerprint';

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

    /** Swap a file's rows wholesale. Pass the new rows in file order. */
    replaceFile(file: string, entries: LedgerEntry[]): void {
        this.dropFile(file);
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
        if (previous.length === 0) return;

        this.dropFile(oldPath);
        // A rename onto an occupied path makes the rows already there stale.
        if (newPath !== oldPath) this.dropFile(newPath);

        const rekeyed = previous.map(entry => ({
            runtimeId: rewriteId(entry.runtimeId),
            file: newPath,
            parent: entry.parent === null ? null : rewriteId(entry.parent),
            ordinal: entry.ordinal,
            fingerprint: entry.fingerprint,
        }));
        this.replaceFile(newPath, rekeyed);
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
    }
}
