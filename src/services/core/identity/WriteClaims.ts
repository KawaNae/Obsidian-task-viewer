import type { Hint } from './IdentityHints';
import { replayEdits, type LineEdit } from '../../../utils/FileLines';

/**
 * A row of a file as a write left it: which line, what it reads, and whose
 * identity it carries (null for a line the write created).
 */
export interface ClaimBase {
    runtimeId: string | null;
    text: string;
    line: number;
}

/** A file's task rows, as the parser sees them. */
export interface ParsedRow {
    line: number;
    text: string;
}

/**
 * Turns a write's report of what it did to the lines into a claim about what
 * the file's task rows now are.
 *
 * The division of labour here is the point of stage 2. A writer knows which
 * lines it touched and cannot know which of them are tasks: whether a line is
 * a task depends on the fence it might sit inside, on a `tv-gen` block, on
 * `tv-ignore`, on which third-party notations are switched on — questions only
 * the parser answers. So the writer reports lines, this answers rows, and the
 * parser is what turns one into the other. An earlier plan had each writer
 * claim its own rows; it would have put a copy of the parser's judgement in
 * every write site, and the duplicate — which copies whole blocks of child
 * lines, fences and all — is exactly where such a copy is wrong.
 *
 * Nothing here decides identity on evidence. Every row either carries an
 * identity the write itself preserved or is declared new, and the scan checks
 * the whole claim against what it reads before believing any of it.
 */
export class WriteClaims {
    /**
     * Per file, the rows the last reported write left behind.
     *
     * This is what lets a second write claim anything when no scan has run in
     * between — the ledger still holds the state before the first write, and
     * the second write's file does not match it. It lives only until the next
     * scan of that file commits: after that the ledger is the authority, and a
     * base kept across a scan that answered some other way (the ladder, when a
     * claim went unadopted) would carry identities the ledger does not agree
     * with. The texts would still line up, so nothing downstream would catch
     * it.
     */
    private readonly bases = new Map<string, ClaimBase[]>();

    /**
     * @param parseRows the file's task rows, in line order, from the same
     *   pipeline a scan uses.
     * @param ledgerRows what the last scan of this file recorded.
     */
    constructor(
        private readonly parseRows: (path: string, lines: readonly string[]) => ParsedRow[],
        private readonly ledgerRows: (path: string) => ClaimBase[],
    ) { }

    /**
     * What this write claims the file's rows now are, or null when it cannot
     * say — in which case the next scan falls to the ladder, as it did before
     * stage 2.
     */
    claim(
        path: string,
        before: readonly string[],
        after: readonly string[],
        edits: readonly LineEdit[],
    ): Hint | null {
        const base = this.baseFor(path, before);
        if (base === null) {
            this.bases.delete(path);
            return null;
        }

        const replayed = replayEdits(before.length, edits);
        if (!replayed || replayed.origin.length !== after.length) {
            this.bases.delete(path);
            return null;
        }

        // Which identity, if any, each line of the file now carries: the one
        // its line carried before the write, unless the write made the line.
        const identityOf = new Map<number, string | null>();
        for (const row of base) identityOf.set(row.line, row.runtimeId);

        const rows: ClaimBase[] = [];
        for (const row of this.parseRows(path, after)) {
            const from = replayed.origin[row.line];
            const carried = from === null ? null : identityOf.get(from) ?? null;
            rows.push({ runtimeId: carried, text: row.text, line: row.line });
        }

        this.bases.set(path, rows);
        return { rows: rows.map(row => ({ runtimeId: row.runtimeId, text: row.text })) };
    }

    /**
     * Forget what this file's last write left.
     *
     * Called when a scan of the file commits, whatever it decided, and when the
     * file's claims are dropped for good (a rename, a delete, `tv-ignore`).
     */
    forget(path: string): void {
        this.bases.delete(path);
    }

    clear(): void {
        this.bases.clear();
    }

    /**
     * The rows to build this claim on: what the last write left, else what the
     * last scan recorded, else nothing.
     *
     * Either candidate is a guess about a file this code did not read, so it is
     * checked rather than trusted: every row has to still read, at the line it
     * was recorded on, what it was recorded as. A file that moved under us
     * fails that and the write claims nothing. It cannot prove there is no row
     * it has never heard of — an external edit adding a task line passes here —
     * but a claim missing a row does not reproduce what the scan reads, so it
     * is refused there instead.
     */
    private baseFor(path: string, before: readonly string[]): ClaimBase[] | null {
        const base = this.bases.get(path);
        if (base && fits(base, before)) return base;

        const ledger = this.ledgerRows(path);
        if (fits(ledger, before)) return ledger;

        return null;
    }
}

function fits(rows: readonly ClaimBase[], lines: readonly string[]): boolean {
    for (const row of rows) {
        if (row.line < 0 || row.line >= lines.length) return false;
        if (lines[row.line] !== row.text) return false;
    }
    return true;
}
