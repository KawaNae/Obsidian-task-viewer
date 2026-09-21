import type { ParserId } from '../../../types';
import type { Hint } from './IdentityHints';
import { replayEdits, type LineEdit } from '../../../utils/FileLines';
import { contentKeyOf, type ContentKey } from './ContentKey';

/**
 * A row of a file as a write left it: which line, what it reads, and whose
 * identity it carries.
 *
 * Every row has a name. A line a write created is named on the spot, by the
 * write, and `created` is what says so: the ledger has not heard that name
 * yet, so a scan must not refuse the row for being absent from it, and must
 * not mint a second name for the same line when it commits.
 */
export interface ClaimBase {
    runtimeId: string;
    created: boolean;
    text: string;
    line: number;
}

/** A file's task rows, as the parser sees them. */
export interface ParsedRow {
    line: number;
    text: string;
    parserId: ParserId;
}

/**
 * What the last scan of a file recorded: the rows it read, and the key of the
 * content it read them from — null when no scan has committed the file.
 */
export interface LedgerState {
    rows: ClaimBase[];
    content: ContentKey | null;
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
 * Either the file as that write left it — the key of its content, and the rows
 * in it, because the content is what decides whether the rows may be used at
 * all (see {@link WriteClaims.stateFor}) — or a refusal: a write landed that
 * this class could not describe, so nothing it holds is true of the file any
 * more, and nothing older is either.
 *
 * `filed` numbers the writes in the order they landed (see
 * {@link WriteClaims.readMark}).
 */
type Base =
    | { content: ContentKey; rows: ClaimBase[]; filed: number }
    | { content: null; rows: null; filed: number };

/**
 * A write changed the file and could not say how.
 *
 * What matters is that the entry is there.
 */
const SILENT = (filed: number): Base => ({ content: null, rows: null, filed });

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
     * What the last write left, for a file whose last scan committed without
     * having read it: the scan read the file before the write landed, and
     * committed after. {@link stateFor} does not build on it, for the reason
     * above. It is kept for one thing only: to say that the ledger is older
     * than a write of ours, and what that write left (see {@link lastWrite}).
     */
    private readonly outrun = new Map<string, Base>();

    /** How many writes have filed here, described or not. */
    private filed = 0;

    /**
     * @param parseRows the file's task rows, in the order a scan matches them,
     *   from the same pipeline a scan uses. Null when the parser refuses to
     *   read the file as tasks at all (`tv-ignore`), which is not the same
     *   answer as a file with no rows in it.
     * @param ledgerState what the last scan of this file recorded.
     * @param mintRuntimeId a name for a row this write made. Issued here, at
     *   the moment the line comes into being, rather than by the scan that
     *   reads it: two scans can read the same created line — one committing a
     *   claim while a second write is already filed on top of it — and a name
     *   issued by the reader would be a different name each time.
     */
    constructor(
        private readonly parseRows: (path: string, lines: readonly string[]) => ParsedRow[] | null,
        private readonly ledgerState: (path: string) => LedgerState,
        private readonly mintRuntimeId: (path: string, parserId: ParserId) => string,
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
            this.bases.set(path, SILENT(++this.filed));
            return { hint: null, withdraw };
        };

        const base = this.stateFor(path, before);
        if (base === null) return nothing();

        const replayed = replayEdits(before.length, edits);
        if (!replayed || replayed.origin.length !== after.length) return nothing();

        // A file the parser will not read as tasks has no rows to claim, and
        // saying it has none would be a claim of its own.
        const parsed = this.parseRows(path, after);
        if (parsed === null) return nothing();

        // Which identity each line of the file now carries: the one its line
        // carried before the write, unless the write made the line.
        const identityOf = new Map<number, ClaimBase>();
        for (const row of base) identityOf.set(row.line, row);

        const rows: ClaimBase[] = [];
        for (const row of parsed) {
            const from = replayed.origin[row.line];
            // `created` travels with the identity, not with this write: a row
            // the *previous* write made is still one the ledger has never
            // heard of, and the scan that finally reads it has to be told so
            // however many writes it has sat through since.
            const carried = from === null ? undefined : identityOf.get(from);
            rows.push(carried
                ? { runtimeId: carried.runtimeId, created: carried.created, text: row.text, line: row.line }
                // Either the write made this line, or it made a task of a line
                // that was not one — a row with no past either way.
                : { runtimeId: this.mintRuntimeId(path, row.parserId), created: true, text: row.text, line: row.line });
        }

        const content = contentKeyOf(after);
        this.bases.set(path, { content, rows, filed: ++this.filed });
        return {
            hint: { content, rows: rows.map(row => ({ runtimeId: row.runtimeId, created: row.created, text: row.text })) },
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
     * What the last write of ours that no committed scan has read left in this
     * file: its rows, or null when it could not say. Undefined when every write
     * of ours to the file has been read by a scan that committed — the only
     * case where the ledger is not known to be older than one of them.
     *
     * Not the same as the base {@link stateFor} builds on: that one is dropped
     * by any scan that commits, this one only by a scan that read the file
     * after the write (see {@link forget}).
     */
    lastWrite(path: string): { rows: readonly ClaimBase[] | null } | undefined {
        const base = this.bases.get(path) ?? this.outrun.get(path);
        return base && { rows: base.rows };
    }

    /**
     * A mark for a scan to take before it reads a file: a write filed after
     * it may be one the read did not see.
     */
    readMark(): number {
        return this.filed;
    }

    /**
     * Forget what this file's last write left.
     *
     * Called when a scan of the file commits, whatever it decided, and when the
     * file's claims are dropped for good (a rename, a delete, `tv-ignore`). A
     * committing scan passes the mark it took before reading: a write filed
     * after that mark is one the ledger it commits may not have seen, and is
     * kept for {@link lastWrite} though never built on again.
     */
    forget(path: string, readMark?: number): void {
        const newest = this.bases.get(path) ?? this.outrun.get(path);
        this.bases.delete(path);
        if (readMark !== undefined && newest && newest.filed > readMark) this.outrun.set(path, newest);
        else this.outrun.delete(path);
    }

    /**
     * The rows these lines are known to hold: what the last write left, else
     * what the last scan recorded, else nothing.
     *
     * Asked about the lines a write was handed, before it changes them, and by
     * two parties: the write's claim builds on the answer, and the write's
     * `locate` reads its target's coordinate off it (see `TaskScanner.locate`).
     * A coordinate is good only inside the content it was read from, and this
     * is the one place that says which content that is.
     *
     * Either candidate is a guess about a file this code did not read, so it is
     * checked rather than trusted, and both are checked the same way: the file
     * has to read, whole, as the candidate says it did — the same comparison a
     * scan makes when it weighs a claim (see `reproduces`) — and each of the
     * candidate's rows has to read its own text on its own line.
     *
     * The whole content, because rows alone say nothing about the lines between
     * them. A file is written by plenty that do not report — a write that
     * reports nothing, a report that did not account for its own file, a
     * writer with no sink at all, frontmatter and headings, which move every
     * row below them without touching a row — and an external edit reports to
     * nobody. Each leaves the candidate describing a file that is no longer
     * there, and the one comparison catches all of them, so nothing has to be
     * delivered to this class for it to know.
     *
     * The rows as well, because the content is compared by key (see
     * `ContentKey`). Two contents sharing a key would also have to put every
     * row's text on the row's line before a claim were built on the wrong one.
     *
     * An entry that is there at all stops the search rather than falling
     * through, whether or not it still fits. Its presence says a write of ours
     * landed after the last scan committed, so the ledger describes a file at
     * least two writes old — and stale in the direction that matters: the rows
     * it holds sit at the line numbers the file had *before* our own write
     * moved them. That is why a refusal leaves {@link SILENT} behind instead of
     * removing the entry: the answer has to stay "nothing" for every write
     * until a scan commits, not just for the one that noticed.
     *
     * *No* entry is not a promise that the ledger is current: {@link forget}
     * runs on every commit, whatever the scan read. A scan that read the file
     * as it was before our last write, and committed after that write filed,
     * takes the base with it and leaves the next write a ledger one write old.
     * Handed a copy inserted above its original, that ledger's row names the
     * copy — the text there is the same word, so its rows still fit. What
     * refuses it is its content: the ledger recorded the file before the copy,
     * and the file this write was handed has it. Checked by rows alone, the
     * copy would be claimed as the original with every text lining up, and a
     * scan comparing whole contents would adopt it.
     *
     * The content does not refuse everything, though: our writes, and what
     * came after them, can bring the file back to the very content that ledger
     * recorded, with the names moved between its lines (delete X, append a
     * row, rename Y to X's text). So a commit hands {@link forget} the mark
     * the scan took before reading, and while a write filed after it is kept
     * (`outrun`), the ledger is not answered with at all.
     *
     * A file no scan has committed has no ledger content, and no rows either —
     * the start-up scan skips a note with no list items, so this is every such
     * note until something writes to it. Nothing there has a name anyone holds,
     * so there is nothing a claim could hand to the wrong line: every row the
     * write finds is new, and it builds on no rows at all.
     */
    stateFor(path: string, before: readonly string[]): ClaimBase[] | null {
        const current = contentKeyOf(before);

        const base = this.bases.get(path);
        if (base) {
            return base.content === current && fits(base.rows, before) ? base.rows : null;
        }

        // A scan committed without having read a write of ours: its ledger is
        // older than that write however well the content fits. The write and
        // what came after it can bring the file back to the very content the
        // ledger recorded, with the names moved between its lines.
        if (this.outrun.has(path)) return null;

        const ledger = this.ledgerState(path);
        if (ledger.content === null) return ledger.rows.length === 0 ? [] : null;
        if (ledger.content === current && fits(ledger.rows, before)) return ledger.rows;

        return null;
    }
}

/** Whether each row still reads its own text on its own line. */
function fits(rows: readonly ClaimBase[], lines: readonly string[]): boolean {
    for (const row of rows) {
        if (row.line < 0 || row.line >= lines.length) return false;
        if (lines[row.line] !== row.text) return false;
    }
    return true;
}
