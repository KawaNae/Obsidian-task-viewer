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

/** What a write claims, and a handle that takes the whole call back. */
export interface ClaimResult {
    /** What the file now reads, or null when this write cannot say. */
    hint: Hint | null;
    /**
     * Undo everything this call left behind.
     *
     * A claim is filed from inside `vault.process`, before the write is known
     * to have landed (see `processLines`), and what it leaves behind is not
     * only the hint the caller holds: it is also the base the *next* write to
     * this file would build on. A write that threw, or whose callback
     * Obsidian ran again, must leave neither.
     */
    withdraw: () => void;
}

/**
 * What this file's last write left for the next one.
 *
 * Either the file as that write left it — every line, and the rows among them,
 * kept whole because the lines are what decides whether the rows may be used
 * at all (see {@link WriteClaims.baseFor}) — or a refusal: a write landed that
 * this class could not describe, so nothing it holds is true of the file any
 * more, and nothing older is either.
 */
type Base =
    | { lines: string[]; rows: ClaimBase[] }
    | { lines: null; rows: null };

/**
 * A write changed the file and could not say how.
 *
 * Shared, and never mutated: what matters is that the entry is there.
 */
const SILENT: Base = { lines: null, rows: null };

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
    private readonly bases = new Map<string, Base>();

    /**
     * @param parseRows the file's task rows, in the order a scan matches them,
     *   from the same pipeline a scan uses. Null when the parser refuses to
     *   read the file as tasks at all (`tv-ignore`), which is not the same
     *   answer as a file with no rows in it.
     * @param ledgerRows what the last scan of this file recorded.
     */
    constructor(
        private readonly parseRows: (path: string, lines: readonly string[]) => ParsedRow[] | null,
        private readonly ledgerRows: (path: string) => ClaimBase[],
    ) { }

    /**
     * What this write claims the file's rows now are — a null `hint` when it
     * cannot say, in which case the next scan falls to the ladder, as it did
     * before stage 2.
     */
    claim(
        path: string,
        before: readonly string[],
        after: readonly string[],
        edits: readonly LineEdit[],
    ): ClaimResult {
        const withdraw = this.rollback(path);
        // Every way out of here without a claim is the same situation: this
        // write changed the file — `processLines` calls a sink for nothing
        // else — and nothing here can say what the file now is. Dropping the
        // base would say the opposite, that the ledger may be read again, and
        // the ledger is older still. So the file is marked silent instead, and
        // stays silent until a scan of it commits.
        const nothing = (): ClaimResult => {
            this.bases.set(path, SILENT);
            return { hint: null, withdraw };
        };

        const base = this.baseFor(path, before);
        if (base === null) return nothing();

        const replayed = replayEdits(before.length, edits);
        if (!replayed || replayed.origin.length !== after.length) return nothing();

        // A file the parser will not read as tasks has no rows to claim, and
        // saying it has none would be a claim of its own.
        const parsed = this.parseRows(path, after);
        if (parsed === null) return nothing();

        // Which identity, if any, each line of the file now carries: the one
        // its line carried before the write, unless the write made the line.
        const identityOf = new Map<number, string | null>();
        for (const row of base) identityOf.set(row.line, row.runtimeId);

        const rows: ClaimBase[] = [];
        for (const row of parsed) {
            const from = replayed.origin[row.line];
            const carried = from === null ? null : identityOf.get(from) ?? null;
            rows.push({ runtimeId: carried, text: row.text, line: row.line });
        }

        this.bases.set(path, { lines: [...after], rows });
        return {
            hint: { rows: rows.map(row => ({ runtimeId: row.runtimeId, text: row.text })) },
            withdraw,
        };
    }

    /**
     * Put this file's base back the way it is at this moment.
     *
     * Taken before the call changes anything, so one handle covers every way
     * out of {@link claim} — the claim that was filed, the mark a refusal left.
     *
     * "The way it is at this moment", not "the way the file is": two writes to
     * one file can be in flight at once, and the later one to fail puts back a
     * state older than the one on disk. What keeps that harmless is that a base
     * is only ever used on a file that still reads, line for line, as the base
     * says — an older base simply goes unused.
     */
    private rollback(path: string): () => void {
        const previous = this.bases.get(path);
        return () => {
            if (previous) this.bases.set(path, previous);
            else this.bases.delete(path);
        };
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

    /**
     * The rows to build this claim on: what the last write left, else what the
     * last scan recorded, else nothing.
     *
     * Either candidate is a guess about a file this code did not read, so it is
     * checked rather than trusted. The two are checked differently, because
     * they are guesses of different strength.
     *
     * A base is checked line for line, the whole file. Only the writes that
     * report keep it up to date, and a file is written by plenty that do not —
     * a write that reports nothing, a report that did not account for its own
     * file, a writer with no sink at all, frontmatter and headings, which move
     * every row below them without touching a row. Each of those leaves a base
     * describing a file that is no longer there, and every one of them is
     * caught by the same comparison, so nothing has to be delivered to this
     * class for it to know. Rows alone would not do: they say nothing about the
     * lines between them.
     *
     * A ledger is checked row by row, because that is all a ledger holds. It
     * cannot prove there is no row it has never heard of — an external edit
     * adding a task line passes here — but a claim missing a row does not
     * reproduce what the scan reads, so it is refused there instead.
     *
     * An entry that is there at all stops the search rather than falling
     * through, whether or not it still fits. Its presence says a write of ours
     * landed after the last scan committed, so the ledger describes a file at
     * least two writes old — known to be stale, and stale in the direction that
     * matters: the rows it holds sit at the line numbers the file had *before*
     * our own write moved them. Handed a copy inserted above its original, the
     * ledger's row names the copy, and this would claim the copy carries the
     * original's identity — with every text lining up, so the scan would adopt
     * it. That is why a refusal leaves {@link SILENT} behind instead of
     * removing the entry: the answer has to stay "nothing" for every write
     * until a scan commits, not just for the one that noticed.
     */
    private baseFor(path: string, before: readonly string[]): ClaimBase[] | null {
        const base = this.bases.get(path);
        if (base) {
            return base.lines !== null && sameLines(base.lines, before) ? base.rows : null;
        }

        const ledger = this.ledgerRows(path);
        if (fits(ledger, before)) return ledger;

        return null;
    }
}

/** Whether the file is still, line for line, the one a write left behind. */
function sameLines(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function fits(rows: readonly ClaimBase[], lines: readonly string[]): boolean {
    for (const row of rows) {
        if (row.line < 0 || row.line >= lines.length) return false;
        if (lines[row.line] !== row.text) return false;
    }
    return true;
}
