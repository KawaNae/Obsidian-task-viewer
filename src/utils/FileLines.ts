import { TFile, type App } from 'obsidian';
import { logError, logWarn } from '../log/log';
import { LINE_BREAK, holdsLineBreak } from './LineBreak';
import { ON_RECORD, readsAsPlanned, subtreeAt, type OnRecord, type RowBasis } from '../services/persistence/RowBasis';

/**
 * A file's line terminator. Obsidian writes LF, but notes arrive with CRLF
 * from `core.autocrlf` checkouts, Windows editors, sync tools and scripts.
 */
export type Eol = '\n' | '\r\n';

export interface SplitLines {
    /** Lines without their terminator — a trailing CR is not part of the text. */
    lines: string[];
    /** What {@link joinLines} puts back between them. */
    eol: Eol;
    /** Whether the content opened with a byte order mark, which is not in `lines`. */
    bom: boolean;
}

/** U+FEFF, the byte order mark a note may open with. */
const BOM = '\uFEFF';

/**
 * Split file content into lines at every terminator Obsidian reads as one
 * (`LINE_BREAK`: CRLF, LF, a CR on its own).
 *
 * Every read and every write goes through here, so "what a line is" has one
 * answer. It had two: the scanner dropped the CR and the writers did not, so
 * `task.originalText` never equalled the line it was read from and every write
 * to a CRLF note was silently dropped (#176).
 *
 * The terminator to write back is decided by majority, ties going to LF: one
 * CRLF line at the top of an otherwise-LF note should not rewrite the whole
 * file on the next write. A file that mixes both is unified — the line arrays
 * the writers splice cannot carry a terminator per line, and carrying one
 * would put the bookkeeping in all seventeen write sites instead of here.
 */
export function splitLines(content: string): SplitLines {
    // The mark belongs to the file, not to its first line. Obsidian's `read`
    // takes it off and `process` hands it over, so without this the scan and
    // the write read line 0 of the same note as two different lines — and a
    // line written from line 0's indentation opened with a second mark.
    const bom = content.startsWith(BOM);
    const text = bom ? content.slice(BOM.length) : content;
    // A CR on its own ends a line too, as it does in the editor (`LINE_BREAK`).
    // Kept inside the line, it put every line below it one number off the
    // editor's, and a write addressed by the editor's number found the same
    // text there on another row.
    const lines = text.split(LINE_BREAK);
    const terminators = lines.length - 1;
    // A lone CR votes with LF: Obsidian saves such a note with LF, and
    // counting it for CRLF would rewrite a whole LF file.
    const crlf = text.split('\r\n').length - 1;

    return { lines, eol: crlf > terminators - crlf ? '\r\n' : '\n', bom };
}

/** Put the lines back together with the terminator the file is written in. */
export function joinLines(lines: string[], eol: Eol): string {
    return lines.join(eol);
}

/**
 * One thing a write did to the file's lines, in the coordinates of the moment.
 *
 * Internal to this module and the replay: a writer never builds one. It says
 * what it did through {@link LineDraft}, which is the only thing that produces
 * these, so the numbers in a report always come from the splice that moved the
 * lines rather than from a second reading of the same intention.
 */
export type LineEdit =
    | { kind: 'replaced'; at: number }
    | { kind: 'inserted'; at: number; count: number }
    | { kind: 'removed'; at: number; count: number }
    /** Lines put in at `at`, each the line then standing at `from[i]`, moved. */
    | { kind: 'carried'; at: number; from: number[] };

/**
 * The lines a write is handed, and the only way it has to change them.
 *
 * Every change goes through here and is reported as it is made, so what the
 * index is told a write did is what the write did: there is no second
 * statement of the same intention to get wrong, and no way to change a line
 * and leave the report out. The lines themselves are read-only to the write —
 * an assignment past the draft would be an edit nobody heard of.
 *
 * Each call describes one operation in the line numbers as they stand *at that
 * moment*, and a run of edits reads back in the order it happened.
 *
 * A rewrite and a tear-down-and-rebuild produce the same file, and nothing
 * made from the file can tell them apart: the lines come out identical either
 * way. Only the writer knows which it meant, and both mistakes cost something.
 * Saying {@link rewrite} where a line was really torn down and rebuilt hands a
 * new task the old one's identity. Splicing a line away and a new one in where
 * it was only rewritten calls a row that is still there new, and the hub or the
 * selection holding it loses its task — the ladder would have kept it by
 * matching the text. So `rewrite` means: this line still belongs to the same
 * task as before.
 */
export interface LineDraft {
    /** The lines as they stand now, after every change made so far. */
    readonly lines: readonly string[];
    /**
     * Do a splice and report it, so the two cannot disagree.
     *
     * The check a report is held to compares text, and text is exactly what
     * a duplicate does not vary: inserting a copy of a line next to that line
     * reads the same whether it went above or below, so a position off by one
     * passes every test that can be made from the file alone — and hands the
     * copy the original's identity, which is the failure this whole mechanism
     * exists to prevent. The remedy is not a better check. It is to take the
     * number that moved the lines and the number that is reported from the
     * same place.
     *
     * A splice that removes and inserts at once says both, in that order: the
     * old lines are gone and the new ones are new. A line being *rewritten*
     * while staying the same task is {@link rewrite} instead.
     */
    splice(at: number, deleteCount: number, ...items: string[]): void;
    /** Make the line at `at` read `text`; it is the same task it was. */
    rewrite(at: number, text: string): void;
    /**
     * Put in at `at` lines that are lines already here, moved: each item is
     * the line now standing at `from` (before this call), to read `text`
     * where it lands.
     *
     * A splice cannot say this. Every line it puts in is a new line, so a
     * write that moves a row by splicing it in below and away from above
     * reports the row gone and a new one made — which is how a move within
     * one file came to lose its task's identity. The carry says which line
     * the moved one is, and the claim hands it that line's name.
     *
     * The source is left where it is; taking it away is a splice of its own,
     * and a report in which one line still stands in two places is not one a
     * file could follow (see {@link replayEdits}). A carried line that reads
     * other than its source is reported rewritten with it, from here, so the
     * text a carry changes is always accounted for.
     */
    carry(at: number, items: ReadonlyArray<{ from: number; text: string }>): void;
}

/**
 * A {@link LineDraft} over one array of lines, and the report it fills in.
 *
 * `processLines` builds this over the lines it is about to hand a write, and a
 * test builds it over the lines it passes in, so both run the same arithmetic
 * instead of a copy of it.
 */
export function draftOver(lines: string[]): { draft: LineDraft; reported: LineEdit[] } {
    const { edits, reported } = recordEdits(lines);
    const draft: LineDraft = {
        lines,
        splice: (at, deleteCount, ...items) => {
            items.forEach(oneLine);
            edits.splice(at, deleteCount, ...items);
        },
        rewrite: (at, text) => {
            oneLine(text);
            lines[at] = text;
            edits.replaced(at);
        },
        carry: (at, items) => {
            items.forEach(item => oneLine(item.text));
            edits.carry(at, items);
        },
    };
    return { draft, reported };
}

/**
 * A draft was handed a line that holds a line break.
 *
 * One element of the array is one line of the file. An element holding a
 * break is written as two lines while every count made of the array — the
 * report, the claim, the content key — says one, so the file and everything
 * said about it part from that line on. Nothing is written instead (see
 * `processLines`).
 */
export class LineBreakInLine extends Error {
    constructor(text: string) {
        super(`a line holds a line break: ${JSON.stringify(text.length > 80 ? text.slice(0, 80) + '…' : text)}`);
        this.name = 'LineBreakInLine';
    }
}

function oneLine(text: string): void {
    if (holdsLineBreak(text)) throw new LineBreakInLine(text);
}

/** What a draft does to its array, each change reported as it is made. */
interface LineEdits {
    /**
     * Do a splice and report it, so the two cannot disagree.
     *
     * The check below compares text, and text is exactly what a duplicate does
     * not vary: inserting a copy of a line next to that line reads the same
     * whether it went above or below, so a position off by one passes every
     * test that can be made from the file alone — and hands the copy the
     * original's identity, which is the failure this whole mechanism exists to
     * prevent. The remedy is not a better check. It is to take the number that
     * moved the lines and the number that is reported from the same place.
     *
     * Which lines, too: the array spliced is the one the write was handed, held
     * here rather than passed in, so a report cannot end up describing some
     * other array.
     *
     * A splice that removes and inserts at once says both, in that order: the
     * old lines are gone and the new ones are new. A line being *rewritten*
     * while staying the same task is {@link replaced} instead.
     */
    splice(at: number, deleteCount: number, ...items: string[]): void;
    /** The line at `at` reads something else now, and is the same task. */
    replaced(at: number): void;
    /**
     * Put in at `at` lines that are lines already here, moved: each item is
     * the line now standing at `from` (before this call), to read `text`
     * where it lands.
     *
     * A splice cannot say this. Every line it puts in is a new line, so a
     * write that moves a row by splicing it in below and away from above
     * reports the row gone and a new one made — which is how a move within
     * one file came to lose its task's identity. The carry says which line
     * the moved one is, and the claim hands it that line's name.
     *
     * The source is left where it is; taking it away is a splice of its own,
     * and a report in which one line still stands in two places is not one a
     * file could follow (see {@link replayEdits}). A carried line that reads
     * other than its source is reported {@link replaced} with it, from here,
     * so the text a carry changes is always accounted for.
     */
    carry(at: number, items: ReadonlyArray<{ from: number; text: string }>): void;
}

/** The arithmetic under {@link draftOver}: each change, and what it reported. */
function recordEdits(lines: string[]): { edits: LineEdits; reported: LineEdit[] } {
    const reported: LineEdit[] = [];
    const edits: LineEdits = {
        splice: (at, deleteCount, ...items) => {
            // What the splice did, not what it was asked to do. `splice`
            // counts a negative index from the end and clamps one past the
            // end, and it removes only as many lines as are there; a report of
            // the arguments would describe a file that was never written.
            const start = spliceStart(lines.length, at);
            const removed = lines.splice(at, deleteCount, ...items);
            if (removed.length > 0) {
                reported.push({ kind: 'removed', at: start, count: removed.length });
            }
            if (items.length > 0) {
                reported.push({ kind: 'inserted', at: start, count: items.length });
            }
        },
        replaced: (at) => { reported.push({ kind: 'replaced', at }); },
        carry: (at, items) => {
            if (items.length === 0) return;
            const start = spliceStart(lines.length, at);
            // Read before the splice: a source at or past `start` moves with it.
            const sources = items.map(item => lines[item.from]);
            lines.splice(at, 0, ...items.map(item => item.text));
            reported.push({ kind: 'carried', at: start, from: items.map(item => item.from) });
            items.forEach((item, i) => {
                if (item.text !== sources[i]) reported.push({ kind: 'replaced', at: start + i });
            });
        },
    };
    return { edits, reported };
}

/** Where `Array.prototype.splice` starts, given what it was passed. */
function spliceStart(length: number, at: number): number {
    const n = Number.isNaN(at) ? 0 : Math.trunc(at);
    return n < 0 ? Math.max(length + n, 0) : Math.min(n, length);
}

/** A row a write brought into being, and the name it was given there. */
export interface MadeRow {
    /** Where it stands in the lines the write left. */
    line: number;
    runtimeId: string;
}

/** What filing a report left: a handle that takes it back, and the rows it named. */
export interface WriteReceipt {
    /**
     * Called when, and only when, the write this report describes did not
     * land: its callback ran again, or the write failed and the file does not
     * read as it was left. Called at most once, and before any later write of
     * ours to the same file files a report — so what it takes back is always
     * our newest report on that file. A write that landed never calls it.
     */
    withdraw: () => void;
    /**
     * The rows the report named on the spot. Empty when nothing was claimed —
     * a name is only worth handing out when the scan that adopts the claim
     * gives the row that same one.
     */
    made: readonly MadeRow[];
}

/**
 * Who a write was made for: the user, through the UI, the editor's menu, the
 * API or a timer; or a flow, carrying out a command's effects. A claim carries
 * it, so that a scan which adopts the claim knows whether the completion it
 * reads there came from the user or from a flow's own write — the question
 * whether a completion may fire (`structure.md`, 論点5). Stage F5 only fills
 * it in; nothing reads it yet.
 */
export type WriteOrigin = 'user' | 'flow';

/**
 * Where a write's report goes: every write that changed the file, once.
 *
 * `edits` is null when the write changed the file and cannot say how — its
 * report does not account for the lines it wrote, or it replaced the file
 * whole. That is not the same as saying nothing: it is the mark that the
 * chain of records broke here, so that nothing on record for the file is
 * taken as describing it until a scan has read it again (see
 * `WriteClaims`). A write of ours that changed the file and left neither a
 * claim nor this mark would leave the last record looking current.
 *
 * `named` holds the rows the write asked for by name and gave a new text,
 * each with the line it left the row on — known to the write whatever the
 * claim makes of it. Not a row it only found, to write beside it: a claim
 * counts the rows a write made or rewrote, and this says the same. Null when
 * the report does not account for the lines, which is not the same answer as
 * a write that rewrote no named row. A write whose claim cannot be built (its
 * lines are no state on record) still says which rows it wrote, and for whom,
 * which is what a completion it made answers to.
 */
export type WriteSink = (
    before: readonly string[],
    after: readonly string[],
    edits: readonly LineEdit[] | null,
    named: ReadonlyMap<string, string> | null,
) => WriteReceipt;

/**
 * What a write names its target by: the row's runtime ID, and the `^id` the
 * row carries when the user wrote one. Not a line number — a line number is a
 * coordinate in some content, and the write does not know which content that
 * was.
 */
export interface TaskRef {
    runtimeId: string;
    blockId?: string;
}

/**
 * Where a named row stands in the lines a write was handed.
 *
 * `at` only when the line is known: the row's `^id` names exactly one line,
 * the lines are a content the plugin has on record, or matching them against
 * the last scan paired the name with one line on evidence rather than on
 * position. `ambiguous` when the name went to one of `count` rows no evidence
 * tells apart. `gone` when the name stands on no line of these.
 *
 * `outdated` when the match was made against a ledger older than a write of
 * ours no scan has read yet, and the line it paired does not read as that
 * write left the row — or the write could not say what it left. The pairing
 * rests on a text that has since moved, so there is no line to answer with
 * (`TaskScanner.againstLastWrite`). The user hears it as `changed`: the note
 * is not as the plugin last knew it.
 *
 * Whether the line reads as the write planned is not asked here. That is the
 * write's basis, checked once by `WriteSession.row`.
 */
export type Located =
    | { kind: 'at'; line: number }
    | { kind: 'ambiguous'; count: number }
    | { kind: 'gone' }
    | { kind: 'outdated' };

/**
 * A line the editor pointed at: its number, and the text the editor showed on
 * it. The one place a write takes a coordinate from outside — the editor's
 * cursor is not a row the index knows — so the coordinate travels with the
 * text that says whether it still holds. The editor's buffer and the file on
 * disk part ways while an edit is unsaved; where they have, the text no longer
 * matches and nothing is written.
 */
export interface EditorLine {
    line: number;
    text: string;
}

/**
 * Why a write was not made: its target was one of `count` rows nothing tells
 * apart, it is on no line of the file, the line the caller pointed at no
 * longer reads what the caller saw there, what it would write has nowhere
 * in the body to go (see `Placement`), or the write itself failed — it threw,
 * or the file could not be read or written.
 */
export type RefusalReason =
    | { kind: 'ambiguous'; count: number }
    | { kind: 'gone' }
    | { kind: 'changed' }
    | { kind: 'unplaceable' }
    | { kind: 'failed' };

/** A write that was not made, as it is told to whoever reports it. */
export interface Refusal {
    file: string;
    reason: RefusalReason;
    /** What the write was about, in the user's words: the task's text or the line's. */
    subject: string;
}

/**
 * What a write to one file is handed by the index: where to report what it
 * did, where to ask for its target, and where to say it gave up.
 *
 * Closures rather than an import, so that the write layer never depends on
 * identity (see `WriteObserver`).
 */
export interface WriteChannel {
    /** Absent where nobody takes a report: no write of the plugin's leaves it out. */
    sink?: WriteSink;
    locate(lines: readonly string[], ref: TaskRef): Located;
    /**
     * Whether the row's line at `line` reads as some text the plugin has on
     * record for the row — the weaker comparison {@link ON_RECORD} keeps.
     */
    onRecord(lines: readonly string[], ref: TaskRef, line: number): boolean;
    refused(refusal: Refusal): void;
}

/**
 * A row a write names, and what the write was planned from: the basis the
 * lines have to read as for the write to be made there (see `RowBasis`).
 */
export interface NamedRow {
    ref: TaskRef;
    subject: string;
    basis: RowBasis | OnRecord;
}

/**
 * What one `processLines` callback is handed besides its draft: where its
 * target stands, and the way to give the write up.
 *
 * `row` is the one way a write takes a line. A row is named with what the
 * write was planned from, or it is a line the editor pointed at with the text
 * the editor showed there; either way, the line is handed out only if the
 * lines read as that. So every write that takes a line checks it once, and the
 * same check, and no write writes a plan over an edit the plan never saw.
 */
export interface WriteSession {
    /**
     * The target's line, or null when it has none — in which case the write is
     * refused, and the callback returns false.
     *
     * The first question about a row is put to the lines as they were handed
     * in: that is the one content the plugin can have on record, so it is the
     * one where a name can be looked for and a basis checked. Asked again, the
     * answer is carried across the edits this write has reported since, and
     * across nothing else — every line the write moved, it moved through its
     * draft, and the report is the whole of what happened to the lines in
     * between. A line the write took away is `gone`. So one write can apply
     * several effects to one row without asking the file a second time, which
     * is where a coordinate would go stale.
     *
     * The carrying is checked, because it is only as good as the report: a line
     * the report does not say was rewritten has to read what it read, and a
     * write that carried a coordinate is refused whole if its report does not
     * account for the lines it returns.
     */
    row(target: NamedRow | EditorLine): number | null;
    /** Give the write up: nothing is written, and the refusal is told once it is over. */
    refuse(reason: RefusalReason, subject: string): false;
}

/**
 * What became of one write: made, or not made and why. Every write of the
 * plugin answers with this — there is no third way for a write to end, an
 * exception included — and a write that was not made has already been told to
 * the user, once, by the write layer (see {@link WriteChannel.refused}).
 */
export type WriteOutcome = WriteMade | WriteRefused;

/**
 * A write that adds one row, and where it put it: the line a caller looks the
 * new row up by once the scan has read it (`TaskApi.createTask`).
 */
export type WriteAt = WriteRefused | (WriteMade & { line: number });

/** A write that was not made. */
export interface WriteRefused {
    written: false;
    refused: Refusal;
}

/** A write that was made. */
export interface WriteMade {
    /** The callback said to write, whether or not the lines differed. */
    written: true;
    refused: null;
    /**
     * The rows the write made, by the names the next scan gives them if it
     * adopts this write's claim. Empty when the write claimed nothing (see
     * {@link WriteReceipt.made}); the names of a claim no scan adopts go
     * with it, and are never given to any line.
     */
    made: readonly MadeRow[];
    /**
     * For each row the write named and left standing, by runtime ID: the row
     * and its subtree as the write was handed them and as it left them. What
     * the index holds of a row it had the write make from its copy can be
     * brought up to the file from here, before any scan reads it. Empty when
     * nothing was written.
     */
    rows: ReadonlyMap<string, RowLines>;
}

/** A row's line and every line of its subtree, before and after one write. */
export interface RowLines {
    /** As the write was handed them — what the file held, whatever the plan read. */
    read: readonly string[];
    /** As the write left them. */
    left: readonly string[];
}

/** Where each line of the file came from, once a write's report is replayed. */
export interface LineOrigins {
    /** For each line now, its index before the write, or null if it is new. */
    origin: Array<number | null>;
    /** For each line now, whether the write said it rewrote it. */
    rewritten: boolean[];
}

/**
 * Replay a write's report over a file of `beforeLength` lines.
 *
 * Answers null when the report does not describe anything a file could do —
 * an index outside the file, a removal running past the end, a line that ends
 * up standing in two places. Callers treat that the same as no report at all.
 */
export function replayEdits(beforeLength: number, edits: readonly LineEdit[]): LineOrigins | null {
    const origin: Array<number | null> = [];
    for (let i = 0; i < beforeLength; i++) origin.push(i);
    const rewritten = new Array<boolean>(beforeLength).fill(false);

    for (const edit of edits) {
        if (!Number.isInteger(edit.at) || edit.at < 0) return null;
        switch (edit.kind) {
            case 'replaced':
                if (edit.at >= origin.length) return null;
                rewritten[edit.at] = true;
                break;
            case 'inserted': {
                if (!Number.isInteger(edit.count) || edit.count < 0) return null;
                if (edit.at > origin.length) return null;
                const fresh = new Array<number | null>(edit.count).fill(null);
                origin.splice(edit.at, 0, ...fresh);
                rewritten.splice(edit.at, 0, ...new Array<boolean>(edit.count).fill(false));
                break;
            }
            case 'removed':
                if (!Number.isInteger(edit.count) || edit.count < 0) return null;
                if (edit.at + edit.count > origin.length) return null;
                origin.splice(edit.at, edit.count);
                rewritten.splice(edit.at, edit.count);
                break;
            case 'carried': {
                if (edit.at > origin.length) return null;
                if (!edit.from.every(from => Number.isInteger(from) && from >= 0 && from < origin.length)) return null;
                origin.splice(edit.at, 0, ...edit.from.map(from => origin[from]));
                rewritten.splice(edit.at, 0, ...edit.from.map(from => rewritten[from]));
                break;
            }
        }
    }

    // A carry leaves its source standing until the write takes it away. One
    // that is never taken away would give one line's name to two, and a claim
    // built on that would hand the moved row's identity to its copy as well.
    const seen = new Set<number>();
    for (const from of origin) {
        if (from === null) continue;
        if (seen.has(from)) return null;
        seen.add(from);
    }

    return { origin, rewritten };
}

/**
 * Whether a write's report accounts for the file it produced.
 *
 * The report is replayed over the lines as they were, and every line that came
 * through unreported has to still read what it read. That catches an edit the
 * writer forgot to mention, an index off by one, and a report that leaves the
 * file a different length than it is. What it cannot catch is `replaced`
 * against tear-down-and-rebuild (see {@link LineEdits}).
 */
function explains(
    before: readonly string[],
    after: readonly string[],
    edits: readonly LineEdit[],
): boolean {
    const replayed = replayEdits(before.length, edits);
    if (!replayed || replayed.origin.length !== after.length) return false;

    for (let i = 0; i < after.length; i++) {
        const from = replayed.origin[i];
        if (from === null || replayed.rewritten[i]) continue;
        if (before[from] !== after[i]) return false;
    }

    return true;
}

/**
 * Read a file as lines, let `edit` change them through a draft, and write them
 * back with the file's own terminator — one atomic `vault.process`.
 *
 * `edit` returns false to write nothing at all: the file is left
 * byte-identical, Obsidian fires no `modify`, and no rescan follows. That is
 * the whole contract for a write that could not be placed. The caller learns
 * it from `written: false` instead of from a no-op it cannot tell apart from
 * success.
 *
 * The channel is not optional, though it may be absent: every caller says
 * which one its write goes to, so no write leaves it out by forgetting it.
 *
 * Where to write is asked of the `channel`, through the session: a write
 * names its target with what it was planned from, `locate` answers where that
 * target stands in these lines, and the lines there have to read as the plan
 * read them (`WriteSession.row`). A write whose target has no line gives up
 * through `session.refuse`,
 * and the refusal is handed to the channel once `vault.process` is over —
 * once, however many times Obsidian ran the callback. With no channel there is
 * nobody to ask, and every target is `gone`: the index that would answer has
 * been taken down.
 *
 * Every change `edit` makes goes through the {@link LineDraft} it is handed,
 * which reports it, and that report is what lets the next scan know which
 * line is which. A report that does not account for the file it produced is
 * logged and dropped, and the sink is told the write could not say what it
 * did (see {@link WriteSink}): every write that changes the file leaves a
 * claim or that mark, never nothing. The write itself still lands — the
 * report is bookkeeping, and losing a user's edit over bookkeeping would be
 * the worse failure by far.
 *
 * Anything a write owes the rest of the plugin belongs on the written branch
 * only. A claim left behind by a write that never happened would be weighed by
 * the next scan of that file against something else entirely.
 */
export async function processLines(
    app: App,
    file: TFile,
    channel: WriteChannel | undefined,
    edit: (draft: LineDraft, eol: Eol, session: WriteSession) => boolean,
): Promise<WriteOutcome> {
    let refused: Refusal | null = null;
    let made: readonly MadeRow[] = [];
    let rows: ReadonlyMap<string, RowLines> = new Map();
    const sink = channel?.sink;
    // A list rather than one slot: `vault.process` may run the callback again,
    // and everything filed has to be withdrawable.
    const withdrawals: Array<() => void> = [];
    // What the write is about, for a refusal said after the callback is over.
    let lastSubject = '';

    const threw = await processOrFail(app, file, channel, withdrawals, attempt, () => lastSubject || file.path);
    if (threw) return threw;

    // Set inside the callback, which the compiler does not follow.
    const outcome = refused as Refusal | null;
    if (outcome !== null) {
        channel?.refused(outcome);
        return { written: false, refused: outcome };
    }
    return { written: true, refused: null, made, rows };

    /** One run of the callback: the content to write, or the content as it was. */
    function attempt(content: string): string {
        // Obsidian may run the callback again (it retries on a conflicting
        // write). The previous attempt's claims describe a file that never
        // reached disk, so they go before this attempt files its own.
        for (const withdraw of withdrawals.splice(0)) withdraw();
        refused = null;
        made = [];
        rows = new Map();

        const { lines, eol, bom } = splitLines(content);
        const before = [...lines];
        // Over `lines` itself: every change the write makes, it makes to
        // this array through the draft, and the draft reports it.
        const { draft, reported } = draftOver(lines);
        const refuse = (reason: RefusalReason, subject: string): false => {
            refused = { file: file.path, reason, subject };
            return false;
        };
        // Each row is asked once, of the lines as they were handed in, and
        // its basis checked there: the answer is its line, or why not.
        const answered = new Map<string, number | RefusalReason>();
        // Whether a coordinate was carried across this write's own edits,
        // and whether carrying one caught the report out.
        let carried = false;
        let unsound: string | null = null;
        const carry = (line: number): number | null => {
            carried = true;
            const replayed = replayEdits(before.length, reported);
            if (!replayed) {
                unsound = 'a report no file could follow';
                return null;
            }
            const now = replayed.origin.indexOf(line);
            // Taken away by this very write: the row is not on these lines.
            if (now < 0) return null;
            if (!replayed.rewritten[now] && lines[now] !== before[line]) {
                unsound = `line ${line} carried to ${now} does not read what it read`;
                return null;
            }
            return now;
        };
        const answer = (target: NamedRow | EditorLine): number | RefusalReason => {
            if (!('ref' in target)) {
                // The editor's line is its own coordinate, good only while
                // the line still reads what the editor showed there.
                return before[target.line] === target.text ? target.line : { kind: 'changed' };
            }
            const located: Located = channel ? channel.locate(before, target.ref) : { kind: 'gone' };
            if (located.kind === 'outdated') return { kind: 'changed' };
            if (located.kind !== 'at') return located;
            const holds = target.basis === ON_RECORD
                ? channel!.onRecord(before, target.ref, located.line)
                : readsAsPlanned(before, located.line, target.basis);
            return holds ? located.line : { kind: 'changed' };
        };
        // The names the write asked for, to say how it left them.
        const named = new Map<string, number>();
        lastSubject = '';
        const session: WriteSession = {
            row: (target) => {
                const subject = 'ref' in target ? target.subject : target.text.trim();
                lastSubject = subject;
                const key = 'ref' in target ? target.ref.runtimeId : `editor:${target.line}`;
                let found = answered.get(key);
                if (found === undefined) {
                    found = answer(target);
                    answered.set(key, found);
                    if ('ref' in target && typeof found === 'number') named.set(key, found);
                }
                if (typeof found !== 'number') { refuse(found, subject); return null; }
                if (reported.length === 0) return found;
                const now = carry(found);
                if (now === null) { refuse({ kind: 'gone' }, subject); return null; }
                return now;
            },
            refuse,
        };
        let next: string[] | null;
        try {
            next = edit(draft, eol, session) ? lines : null;
        } catch (error) {
            if (!(error instanceof LineBreakInLine)) throw error;
            // A caller's bug, not the user's: the input should have been
            // refused where it came in (`TaskApi`). The file is left as it
            // was rather than written with a line the report cannot count.
            const message = `[FileLines] ${file.path}: ${error.message}; nothing written`;
            if (__DEV__) throw new BrokenWrite(message);
            logError(message, { notice: false });
            refuse({ kind: 'failed' }, lastSubject || file.path);
            return content;
        }

        // A write that took a coordinate across its own edits wrote where
        // its report said the row had gone. If the report does not account
        // for the lines, that coordinate is not known to be the row's, and
        // nothing is written rather than something in the wrong place.
        if (unsound === null && next !== null && carried && !explains(before, next, reported)) {
            unsound = 'its report does not account for the lines it wrote';
        }
        if (unsound !== null) {
            const message = `[FileLines] ${file.path}: a coordinate was carried across this write's edits, but ${unsound}; nothing written`;
            if (__DEV__) throw new BrokenWrite(message);
            logError(message, { notice: false });
            refuse({ kind: 'changed' }, lastSubject);
            return content;
        }
        if (next === null) {
            // Every way a callback gives a write up says why (`refuse`,
            // or `row` answering null). One that just returns false has
            // not, and would leave its caller a write neither made nor
            // refused.
            if (refused === null) {
                const message = `[FileLines] ${file.path}: a write was given up without a reason; nothing written`;
                if (__DEV__) throw new BrokenWrite(message);
                logError(message, { notice: false });
                refuse({ kind: 'failed' }, lastSubject || file.path);
            }
            return content;
        }
        refused = null;

        rows = rowsLeft(before, reported, next, named);
        // The mark the note opened with, put back where it was.
        const rebuilt = (bom ? BOM : '') + joinLines(next, eol);

        // A rewrite that produced the same bytes is not a write: Obsidian
        // fires no `modify` for it, so no scan follows, and a claim filed
        // here would wait for a scan that never comes. The caller still
        // hears `true` — the line was found, which is what it asked.
        //
        // Claims are handed over here rather than after the `await` on
        // purpose: the scan this write triggers starts reading before
        // `vault.process` resolves, so a claim raised afterwards is too late
        // for it. Filing early means filing before the write is known to
        // have succeeded, which is what the withdrawal below is for.
        if (sink && rebuilt !== content) {
            const accounted = explains(before, next, reported);
            if (!accounted) {
                logError(`[FileLines] ${file.path}: a write's report does not account for the lines it wrote; no claim filed, the chain of records marked broken`);
            }
            const receipt = sink(before, next, accounted ? reported : null, accounted ? rewrittenBy(rows) : null);
            withdrawals.push(receipt.withdraw);
            made = receipt.made;
        }

        return rebuilt;
    }
}

/**
 * A development build's report of a bug in a write's caller — a line handed
 * over with a break in it, a report that does not follow — thrown so the bug
 * is seen. A release build refuses the write instead.
 */
export class BrokenWrite extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BrokenWrite';
    }
}

/**
 * Run one `vault.process`, and answer `failed` — told once through the
 * channel — if it throws without the file reading as `attempt` left it.
 *
 * Obsidian can fail after the callback, and a failure there does not say
 * whether the bytes reached disk. The file does: if it reads as the callback
 * left it, the write landed, and what it filed stands (null). Otherwise the
 * file never changed, so claims about it describe a state that never
 * existed; left in the log they would be matched against whatever the next
 * scan happens to read, and they are withdrawn.
 *
 * This is the one place that decides whether a write that filed a report
 * landed, and a withdrawal is how the rest of the plugin hears that it did not (see
 * {@link WriteReceipt.withdraw}). The file only answers for this write while
 * no other write of ours has touched it since, so writes to one file run here
 * one at a time, the reading back included.
 */
function processOrFail(
    app: App,
    file: TFile,
    channel: WriteChannel | undefined,
    withdrawals: Array<() => void>,
    attempt: (content: string) => string,
    subject: () => string,
): Promise<WriteRefused | null> {
    const ahead = inLine.get(file);
    const run = () => processAndSettle(app, file, channel, withdrawals, attempt, subject);
    // Nothing ahead: start now, as a write did before there was a line.
    const mine = ahead ? ahead.then(run) : run();
    const settled = mine.then(() => undefined, () => undefined);
    inLine.set(file, settled);
    void settled.then(() => {
        if (inLine.get(file) === settled) inLine.delete(file);
    });
    return mine;
}

/** Each file's latest write through {@link processOrFail}, settled when it is done. */
const inLine = new WeakMap<TFile, Promise<void>>();

async function processAndSettle(
    app: App,
    file: TFile,
    channel: WriteChannel | undefined,
    withdrawals: Array<() => void>,
    attempt: (content: string) => string,
    subject: () => string,
): Promise<WriteRefused | null> {
    // What the latest run of the callback handed back to be written, or null
    // while it has handed back nothing: it threw, or has not run.
    let handedBack: string | null = null;
    try {
        await app.vault.process(file, (content) => {
            handedBack = null;
            handedBack = attempt(content);
            return handedBack;
        });
        return null;
    } catch (error) {
        // A development build's report of a caller's bug: seen, not absorbed.
        if (error instanceof BrokenWrite) {
            for (const withdraw of withdrawals) withdraw();
            throw error;
        }
        if (handedBack !== null && await readsAs(app, file, handedBack)) {
            logWarn(`[FileLines] ${file.path}: the write reported a failure, but the file reads as written; kept: ${String(error)}`);
            return null;
        }
        for (const withdraw of withdrawals) withdraw();
        return writeFailed(channel, file.path, subject(), error);
    }
}

/** A write that threw: logged, refused as `failed`, and told once. */
export function writeFailed(channel: WriteChannel | undefined, file: string, subject: string, error: unknown): WriteRefused {
    logError(`[FileLines] ${file}: the write failed; nothing written: ${String(error)}`, { notice: false });
    const refused: Refusal = { file, reason: { kind: 'failed' }, subject };
    channel?.refused(refused);
    return { written: false, refused };
}

/**
 * A write whose file is not there to open (taken away, renamed, a folder):
 * refused as `gone` and told once, as a write that finds no line is.
 */
export function fileGone(channel: WriteChannel | undefined, file: string, subject: string): WriteRefused {
    const refused: Refusal = { file, reason: { kind: 'gone' }, subject };
    channel?.refused(refused);
    return { written: false, refused };
}

/**
 * Create a note holding what `content` makes, as one write: made, with the
 * note, or refused as `failed` and told once. Every note the plugin creates
 * for a write is created here. Making the content — a folder to put it in, a
 * template to read — is part of the write, and failing there fails it too.
 * As with `processLines`, a failure that left the note in place reading as
 * asked is a write that landed.
 *
 * Nothing is filed: a note that did not exist has nothing in the ledger, and
 * a claim would say what the ledger's silence already says. So these writes
 * do not queue with the ones that file (see {@link processOrFail}).
 */
export async function createFile(
    app: App,
    path: string,
    channel: WriteChannel | undefined,
    subject: string,
    content: () => string | Promise<string>,
): Promise<WriteRefused | (WriteMade & { file: TFile })> {
    let asked: string | null = null;
    try {
        asked = await content();
        const file = await app.vault.create(path, asked);
        return { written: true, refused: null, made: [], rows: new Map(), file };
    } catch (error) {
        const made = app.vault.getAbstractFileByPath(path);
        if (!(asked !== null && made instanceof TFile && await readsAs(app, made, asked))) {
            return writeFailed(channel, path, subject, error);
        }
        logWarn(`[FileLines] ${path}: creating the note reported a failure, but it reads as written; kept: ${String(error)}`);
        return { written: true, refused: null, made: [], rows: new Map(), file: made };
    }
}

/** Whether the file now reads as `content`, the mark at its head aside. A file that cannot be read does not. */
async function readsAs(app: App, file: TFile, content: string): Promise<boolean> {
    try {
        const now = await app.vault.read(file);
        return now.replace(/^\uFEFF/, '') === content.replace(/^\uFEFF/, '');
    } catch {
        return false;
    }
}

/** The line each named row was left on, for the rows the write gave a new text. */
function rewrittenBy(rows: ReadonlyMap<string, RowLines>): Map<string, string> {
    const left = new Map<string, string>();
    for (const [runtimeId, lines] of rows) {
        if (lines.left.length > 0 && lines.left[0] !== lines.read[0]) left.set(runtimeId, lines.left[0]);
    }
    return left;
}

/** Each named row still standing once the write is done: its subtree before and after. */
function rowsLeft(
    before: readonly string[],
    edits: readonly LineEdit[],
    after: readonly string[],
    named: ReadonlyMap<string, number>,
): Map<string, RowLines> {
    const rows = new Map<string, RowLines>();
    const replayed = replayEdits(before.length, edits);
    if (!replayed) return rows;
    for (const [runtimeId, line] of named) {
        const now = replayed.origin.indexOf(line);
        if (now >= 0) rows.set(runtimeId, { read: subtreeAt(before, line), left: subtreeAt(after, now) });
    }
    return rows;
}

/**
 * Replace a file's content whole — one atomic `vault.process` — for a writer
 * that builds the file from scratch rather than editing its lines (a saved
 * template).
 *
 * Such a write cannot say which line became which, and a report that every
 * line went and new ones came would call any row in the new content new,
 * where the ladder could have told it by its text. So it claims nothing and
 * marks the chain of records broken instead (see {@link WriteSink}). A write
 * that changes nothing is no write, as in {@link processLines}.
 */
export async function replaceWhole(
    app: App,
    file: TFile,
    channel: WriteChannel | undefined,
    content: string,
): Promise<WriteOutcome> {
    const withdrawals: Array<() => void> = [];
    const threw = await processOrFail(app, file, channel, withdrawals, (current) => {
        for (const withdraw of withdrawals.splice(0)) withdraw();
        if (current === content) return current;
        const sink = channel?.sink;
        if (sink) withdrawals.push(sink(splitLines(current).lines, splitLines(content).lines, null, null).withdraw);
        return content;
    }, () => file.path);
    return threw ?? { written: true, refused: null, made: [], rows: new Map() };
}
