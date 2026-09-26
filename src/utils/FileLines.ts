import { TFile, type App } from 'obsidian';
import { logError, logWarn } from '../log/log';
import { LINE_BREAK, holdsLineBreak } from './LineBreak';
import { Outline, type OutlineReading } from '../services/parsing/utils/Outline';
import { checkWrite, type PutBlock, type WrittenLine } from '../services/parsing/utils/OutlineCheck';
import { readsAsPlanned, subtreeAt, type RowBasis } from '../services/persistence/RowBasis';
import { Block, type PlacedLine, type Spot } from '../services/persistence/utils/Placement';
import { contentKeyOf, type ContentKey } from '../services/core/ContentKey';
import type { ReadingId } from '../services/core/Reading';

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
 * Lines a `LineDraft.put` put in: the first of them is line `offset` of the
 * write's `id`th block. Kept beside the report, by the edit that put them in,
 * for the write's own check (`checkWrite`): the report says what became
 * of the lines, and is what the index is told; which block a line came from
 * is the write's business.
 */
export interface PutAt {
    id: number;
    offset: number;
}

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
 * new task the old one's name (`WriteLinks`). Splicing a line away and a new
 * one in where it was only rewritten calls a row that is still there new, and
 * the hub or the selection holding its name loses its task. So `rewrite`
 * means: this line still belongs to the same task as before.
 */
export interface LineDraft {
    /** The lines as they stand now, after every change made so far. */
    readonly lines: readonly string[];
    /**
     * The reading of {@link lines} as they stand now (`Outline.read`): what a
     * write asks `Placement` and the outline of. Made once, and again only
     * after a change: the reading of the lines as handed in, while nothing
     * has changed them, is the one the write's checks read too
     * (`editLines`).
     */
    reading(): OutlineReading;
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
     * Put `block` in at `spot` (`Placement`): the one way a write adds a line
     * below the frontmatter. The block goes at the spot's indentation
     * (`Block.at`), so a caller writes its
     * lines as they stand where they come from, or with none, and never
     * indents them for the spot. Each line says how it is to read once written,
     * and the write is made only if it does and every other line reads as it
     * did (`checkWrite`, in `processLines`). A line spliced into the body
     * without a block is a bug in the write.
     *
     * A line with `from` is the line now standing there (before this call),
     * moved, to read its `text` where it lands. A splice cannot say this:
     * every line it puts in is a new line, so a write that moves a row by
     * splicing it in below and away from above reports the row gone and a new
     * one made — which is how a move within one file came to lose its task's
     * identity. The source is left where it is; taking it away is a splice of
     * its own, and a report in which one line still stands in two places is
     * not one a file could follow (see {@link replayEdits}). A carried line
     * that reads other than its source is reported rewritten with it, from
     * here, so the text a carry changes is always accounted for. A block is
     * carried lines or new ones, not both (`UnfollowableDraft`).
     */
    put(spot: Spot, block: readonly PlacedLine[]): void;
}

/**
 * A {@link LineDraft} over one array of lines, and the report it fills in.
 *
 * `processLines` builds this over the lines it is about to hand a write, and a
 * test builds it over the lines it passes in, so both run the same arithmetic
 * instead of a copy of it. `handedReading`, when given, answers the reading of
 * the lines as handed in, for the draft to use until it changes them.
 */
export function draftOver(lines: string[], handedReading?: () => OutlineReading): {
    draft: LineDraft;
    reported: LineEdit[];
    puts: PutBlock[];
    placedBy: ReadonlyMap<LineEdit, PutAt>;
} {
    const { edits, reported, placedBy } = recordEdits(lines);
    const handed = lines.length;
    const puts: PutBlock[] = [];
    // The reading of the lines as they stand, once asked for; dropped at
    // every change, and made anew when asked for again.
    let reading: OutlineReading | null = null;
    let changed = false;
    const change = () => { reading = null; changed = true; };
    const draft: LineDraft = {
        lines,
        reading: () => reading ??= (!changed && handedReading ? handedReading() : Outline.read(lines)),
        splice: (at, deleteCount, ...items) => {
            items.forEach(oneLine);
            change();
            edits.splice(at, deleteCount, ...items);
        },
        rewrite: (at, text) => {
            oneLine(text);
            change();
            lines[at] = text;
            edits.replaced(at);
        },
        put: (spot, given) => {
            const block = Block.at(given, spot.indent);
            block.forEach(line => oneLine(line.text));
            // A block is new lines or carried ones, not both.
            const carried = block.length > 0 && block[0].from !== undefined;
            if (block.some(line => (line.from !== undefined) !== carried)) {
                throw new UnfollowableDraft('a block put mixes carried lines with new ones');
            }
            // The parent as a line of the lines handed in or of a block, so
            // the check finds it wherever the edits after this one leave it.
            let parent: WrittenLine | null = null;
            if (spot.parent !== null) {
                const written = writtenLines(handed, reported, placedBy);
                if (written === null) throw new UnfollowableDraft('a put follows a report no file could follow');
                parent = written[spot.parent];
            }
            const id = puts.length;
            change();
            puts.push({ parent, lines: block.map(({ kind, under }) => ({ kind, under })) });
            if (carried) edits.carry(spot.at, block.map(line => ({ from: line.from!, text: line.text })), { id, offset: 0 });
            else edits.insert(spot.at, block.map(line => line.text), { id, offset: 0 });
        },
    };
    return { draft, reported, puts, placedBy };
}

/**
 * A draft was handed a line that holds a line break.
 *
 * One element of the array is one line of the file. An element holding a
 * break is written as two lines while every count made of the array — the
 * report, the reading the write lands, the content key — says one, so the file and everything
 * said about it part from that line on. Nothing is written instead (see
 * `processLines`).
 */
export class LineBreakInLine extends Error {
    constructor(text: string) {
        super(`a line holds a line break: ${JSON.stringify(text.length > 80 ? text.slice(0, 80) + '…' : text)}`);
        this.name = 'LineBreakInLine';
    }
}

/**
 * A draft was asked for what its report cannot say: a block of carried lines
 * and new ones together, or a put after edits no file could follow. A
 * caller's bug, told as one by `processLines`, as a {@link LineBreakInLine} is.
 */
export class UnfollowableDraft extends Error {
    constructor(what: string) {
        super(what);
        this.name = 'UnfollowableDraft';
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
    /** Insert `items` at `at`: lines of a block, the first its line `put.offset`. */
    insert(at: number, items: string[], put: PutAt): void;
    /**
     * Put in at `at` lines that are lines already here, moved: each item is
     * the line now standing at `from` (before this call), to read `text`
     * where it lands.
     *
     * A splice cannot say this. Every line it puts in is a new line, so a
     * write that moves a row by splicing it in below and away from above
     * reports the row gone and a new one made — which is how a move within
     * one file came to lose its task's identity. The carry says which line
     * the moved one is.
     *
     * The source is left where it is; taking it away is a splice of its own,
     * and a report in which one line still stands in two places is not one a
     * file could follow (see {@link replayEdits}). A carried line that reads
     * other than its source is reported {@link replaced} with it, from here,
     * so the text a carry changes is always accounted for.
     */
    carry(at: number, items: ReadonlyArray<{ from: number; text: string }>, put: PutAt): void;
}

/** The arithmetic under {@link draftOver}: each change, and what it reported. */
function recordEdits(lines: string[]): { edits: LineEdits; reported: LineEdit[]; placedBy: Map<LineEdit, PutAt> } {
    const reported: LineEdit[] = [];
    const placedBy = new Map<LineEdit, PutAt>();
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
        insert: (at, items, put) => {
            if (items.length === 0) return;
            const start = spliceStart(lines.length, at);
            lines.splice(at, 0, ...items);
            const edit: LineEdit = { kind: 'inserted', at: start, count: items.length };
            reported.push(edit);
            placedBy.set(edit, put);
        },
        carry: (at, items, put) => {
            if (items.length === 0) return;
            const start = spliceStart(lines.length, at);
            // Read before the splice: a source at or past `start` moves with it.
            const sources = items.map(item => lines[item.from]);
            lines.splice(at, 0, ...items.map(item => item.text));
            const edit: LineEdit = { kind: 'carried', at: start, from: items.map(item => item.from) };
            reported.push(edit);
            placedBy.set(edit, put);
            items.forEach((item, i) => {
                if (!Outline.VERBATIM.holds(item.text, sources[i])) reported.push({ kind: 'replaced', at: start + i });
            });
        },
    };
    return { edits, reported, placedBy };
}

/** Where `Array.prototype.splice` starts, given what it was passed. */
function spliceStart(length: number, at: number): number {
    const n = Number.isNaN(at) ? 0 : Math.trunc(at);
    return n < 0 ? Math.max(length + n, 0) : Math.min(n, length);
}

/**
 * A line the editor pointed at: its number, the text the editor showed on it,
 * and the content it was taken in. The one place a write takes a coordinate
 * from outside — the editor's cursor is not a row the index knows.
 *
 * A coordinate in the editor holds only in the content it was taken in: an
 * unsaved line above, or an edit from outside, can bring a twin onto its
 * number, and the twin reads as the text did. So the write is made only in
 * lines whose key is `key` (`WriteSession.row`), whether they are the
 * editor's or the file's, and there only if the line still reads `text`.
 */
export interface EditorLine {
    line: number;
    text: string;
    /** The key of the content `line` is a coordinate in: the editor's document when the line was taken. */
    key: ContentKey;
    /**
     * The line and every line of its subtree as the editor showed them, for a
     * write that takes them away. The write is made only if the file still
     * reads them so, as a delete that names its row is (F5).
     */
    subtree?: readonly string[];
}

/**
 * Why a write was not made: its target is on no line of the file, the line
 * the caller pointed at no longer reads what the caller saw there, a line it would put in would not
 * read as meant where it goes (`unplaceable`), writing it would change what
 * another line is or which item it stands in (`disturbs`; both are
 * `checkWrite`), or the write itself failed — it threw, or the file could
 * not be read or written.
 */
export type RefusalReason =
    | { kind: 'gone' }
    | { kind: 'changed' }
    | { kind: 'unplaceable' }
    | { kind: 'disturbs' }
    | { kind: 'failed' };

/** A write that was not made, as it is told to whoever reports it. */
export interface Refusal {
    file: string;
    reason: RefusalReason;
    /** What the write was about, in the user's words: the task's text or the line's. */
    subject: string;
}

/**
 * What a write to one file is handed by the index: where to hand what it left
 * once it landed, and where to say it gave up.
 *
 * Closures rather than an import, so that the write layer never depends on
 * the index (see {@link WriteChannels}).
 */
export interface WriteChannel {
    /**
     * A write changed the file and landed: `landing.lines` is what the file
     * holds now. Told once per write, after `vault.process` is over, and only
     * when it landed (`processOrFail`) — so what it hands over is not a guess
     * about the file but one reading of it.
     */
    landed(landing: Landing): void;
    refused(refusal: Refusal): void;
    /**
     * Where line `line` of reading `read` stands in content `now`, the one the
     * write was handed: the line itself when `read` is the index's reading and
     * the file still reads as it did, the line our own writes carried it to
     * when only they came between; null when anything else did, or one of
     * ours took the line away (see `WriteLinks`).
     */
    follow(read: ReadingId, line: number, now: ContentKey): number | null;
    /**
     * The index's last reading of the file, asked as the write is handed the
     * lines: which reading the write starts from (`Landing.handed`).
     */
    reading(): ReadMark;
}

/**
 * The index's last reading of a file (`WriteChannel.reading`): its number, and
 * the key of its content — undefined when the file has none read now.
 */
export interface ReadMark {
    n: number;
    key: ContentKey | undefined;
}

/**
 * Where the writers get the channel for a write to `file`: undefined while
 * nothing is listening.
 *
 * Handed in as a function rather than imported, and cut by the index that
 * connected it when it is taken down (`TaskRepository.disconnect`): a plugin
 * that reloads without a restart can leave a previous index alive for a while
 * (#165), and a write that outlives its index lands nothing in it and finds
 * nobody to tell.
 */
export type WriteChannels = (file: string) => WriteChannel | undefined;

/** What a write that landed left in the file (see {@link WriteChannel.landed}). */
export interface Landing {
    /** The lines as the write was handed them. */
    before: readonly string[];
    /** The lines as the write left them: what the file reads now. */
    lines: readonly string[];
    /**
     * The draft's report, when it accounts for every line it left (see
     * {@link explains}); null for a write that could not say how it changed
     * the lines, or that replaced them whole.
     */
    edits: readonly LineEdit[] | null;
    /** The reading of `lines` the write's own check made, or null when it made none. */
    reading: OutlineReading | null;
    /**
     * The index's last reading of the file when the write was handed `before`
     * (`WriteChannel.reading`): what says which reading the write left, and
     * whether one given since makes it late.
     */
    handed: ReadMark;
}

/**
 * A row a write names: the line the index's copy of it stands on, and what
 * the write was planned from — the basis the lines have to read as, on that
 * line, for the write to be made there (see `RowBasis`).
 *
 * The line is a coordinate in the content the index last read. The basis is
 * what says whether the lines handed to the write are still that content
 * where it matters: a line moved or rewritten since reads otherwise there,
 * and nothing is written. Nothing looks for the row anywhere else.
 *
 * The basis cannot tell two rows that read the same apart: an edit from
 * outside can move a row's twin onto its line. So a row the index read names
 * the reading it was read in (`read`), and its line counts only while the
 * file reads as that reading did, or as our own writes from it left it,
 * across which the line is carried ({@link WriteChannel.follow}). A content
 * the file had before is not that reading: a write of ours can bring it back
 * with other rows on its lines. In any other content the row is not written,
 * however its line reads, until the index has read the file again.
 */
export interface NamedRow {
    line: number;
    subject: string;
    basis: RowBasis;
    /**
     * The reading `line` is a coordinate in. A row without one is not
     * written.
     */
    read?: ReadingId;
}

/**
 * What one `processLines` callback is handed besides its draft: where its
 * target stands. A write is given up only when `row` answers null, so the
 * refusal and whom it is about are answered here, in one place.
 *
 * `row` is the one way a write takes a line. A row is named with what the
 * write was planned from, or it is a line the editor pointed at with the text
 * the editor showed there and the content it was taken in; either way, the
 * line is handed out only if the lines read as that. So every write that takes a line checks it once, and the
 * same check, and no write writes a plan over an edit the plan never saw.
 */
export interface WriteSession {
    /**
     * The target's line, or null when it has none — in which case the write is
     * refused, and the callback returns false.
     *
     * The first question about a row is put to the lines as they were handed
     * in: its line there has to read as its basis. Asked again, the
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
}

/** Where each line of the file came from, once a write's report is replayed. */
export interface LineOrigins {
    /** For each line now, its index before the write, or null if it is new. */
    origin: Array<number | null>;
    /** For each line now, whether the write said it rewrote it. */
    rewritten: boolean[];
    /** For each line now, the block and the line of it a `put` put there, or null. */
    placed: Array<PutAt | null>;
}

/**
 * Replay a write's report over a file of `beforeLength` lines.
 *
 * Answers null when the report does not describe anything a file could do —
 * an index outside the file, a removal running past the end, a line that ends
 * up standing in two places. Callers treat that the same as no report at all.
 * `placedBy` says which edits put in lines of a block (`LineDraft.put`).
 */
export function replayEdits(
    beforeLength: number,
    edits: readonly LineEdit[],
    placedBy: ReadonlyMap<LineEdit, PutAt> = new Map(),
): LineOrigins | null {
    const origin: Array<number | null> = [];
    for (let i = 0; i < beforeLength; i++) origin.push(i);
    const rewritten = new Array<boolean>(beforeLength).fill(false);
    const placed = new Array<PutAt | null>(beforeLength).fill(null);
    const putLines = (put: PutAt | undefined, count: number) =>
        Array.from({ length: count }, (_, i) => (put ? { id: put.id, offset: put.offset + i } : null));

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
                placed.splice(edit.at, 0, ...putLines(placedBy.get(edit), edit.count));
                break;
            }
            case 'removed':
                if (!Number.isInteger(edit.count) || edit.count < 0) return null;
                if (edit.at + edit.count > origin.length) return null;
                origin.splice(edit.at, edit.count);
                rewritten.splice(edit.at, edit.count);
                placed.splice(edit.at, edit.count);
                break;
            case 'carried': {
                if (edit.at > origin.length) return null;
                if (!edit.from.every(from => Number.isInteger(from) && from >= 0 && from < origin.length)) return null;
                origin.splice(edit.at, 0, ...edit.from.map(from => origin[from]));
                rewritten.splice(edit.at, 0, ...edit.from.map(from => rewritten[from]));
                placed.splice(edit.at, 0, ...putLines(placedBy.get(edit), edit.from.length));
                break;
            }
        }
    }

    // A carry leaves its source standing until the write takes it away. One
    // that is never taken away would leave one line standing in two places.
    const seen = new Set<number>();
    for (const from of origin) {
        if (from === null) continue;
        if (seen.has(from)) return null;
        seen.add(from);
    }

    return { origin, rewritten, placed };
}

/**
 * Where each line of a write's result came from, as `checkWrite` asks it:
 * put in by a block, kept from the lines handed in, or spliced in loose. Null
 * when the report does not describe anything a file could do.
 */
function writtenLines(
    beforeLength: number,
    edits: readonly LineEdit[],
    placedBy: ReadonlyMap<LineEdit, PutAt>,
): WrittenLine[] | null {
    const replayed = replayEdits(beforeLength, edits, placedBy);
    if (!replayed) return null;
    return replayed.origin.map((from, k): WrittenLine => {
        const put = replayed.placed[k];
        if (put) return { kind: 'placed', put: put.id, offset: put.offset };
        return from === null ? { kind: 'loose' } : { kind: 'kept', from };
    });
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
 * What {@link editLines} made of one set of lines: the lines as the write left
 * them, with the report that says which line became which and the rows it
 * named; or the refusal, and nothing written.
 */
export type EditedLines =
    | {
        written: true;
        /** The lines as they were handed in. */
        before: readonly string[];
        /** The lines as the write left them. */
        lines: readonly string[];
        /** The draft's report: every change the write made, in order. */
        edits: readonly LineEdit[];
        /** The reading of `lines` the write's check made, or null when it made none. */
        reading: OutlineReading | null;
    }
    | { written: false; refused: Refusal };

/** The text a write is about when it asks for `target`: a named row's subject, the editor's line. */
function subjectOf(target: NamedRow | EditorLine): string {
    return 'basis' in target ? target.subject : target.text.trim();
}

/**
 * Let `edit` change `lines` through a draft, and answer what came of it,
 * writing nothing anywhere: the one core every write of lines runs, whatever
 * the lines are then written to (`processLines` writes them to the file).
 *
 * Where to write is asked through the session: a write names its target by
 * the line it was planned on and what it was planned from, and the lines
 * there have to read as the plan read them (`WriteSession.row`). A write
 * whose target does not read so gives up when `row` answers null, and the
 * refusal is what this answers.
 *
 * Every change `edit` makes goes through the {@link LineDraft} it is handed,
 * which reports it. The write is held to that report: the lines it put in
 * have to read as put, and every other line as it did (`checkWrite`); else
 * nothing is written, and the write is refused as `unplaceable` or
 * `disturbs`. A report no file could follow is a bug in the write and is not
 * written either (see `BrokenWrite`).
 *
 * A refusal is told by what the write is about: the subject of the row it
 * asked for last (`NamedRow.subject`, the editor's text), else `about`, else
 * the file. `asked` hears each subject as the write asks for its row, for a
 * caller that has to name the write after it threw.
 *
 * A row that names the reading it was read in (`NamedRow.read`) is taken in
 * these lines only where `subjects.follow` finds its line in them (the write's
 * channel, `WriteChannel.follow`); without it, not at all.
 *
 * `lines` is not changed: the draft works on a copy.
 */
export function editLines(
    path: string,
    lines: readonly string[],
    eol: Eol,
    edit: (draft: LineDraft, eol: Eol, session: WriteSession) => boolean,
    subjects: {
        about?: string;
        asked?: (subject: string) => void;
        follow?: (read: ReadingId, line: number, now: ContentKey) => number | null;
    } = {},
): EditedLines {
    let refused: Refusal | null = null;
    let lastSubject = '';
    const subject = () => lastSubject || subjects.about || path;

    const before = [...lines];
    // The reading of the lines as handed in, made once and only if asked
    // for: by a plan's check (`readsAsPlanned`), by the draft until it
    // changes the lines (`LineDraft.reading`), and by the write's check.
    let handedReading: OutlineReading | null = null;
    const readBefore = (): OutlineReading => handedReading ??= Outline.read(before);
    // Every change the write makes, it makes to this array through the
    // draft, and the draft reports it.
    const working = [...lines];
    const { draft, reported, puts, placedBy } = draftOver(working, readBefore);
    const refuse = (reason: RefusalReason, about: string): false => {
        refused = { file: path, reason, subject: about };
        return false;
    };
    // Each target is asked once, of the lines as they were handed in, and
    // its basis checked there: the answer is its line, or why not.
    const answered = new Map<NamedRow | EditorLine, number | RefusalReason>();
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
        if (!replayed.rewritten[now] && !Outline.VERBATIM.holds(working[now], before[line])) {
            unsound = `line ${line} carried to ${now} does not read what it read`;
            return null;
        }
        return now;
    };
    // The key of the lines as handed in, made once and only if a row asks.
    let handed: ContentKey | null = null;
    const answer = (target: NamedRow | EditorLine): number | RefusalReason => {
        // A coordinate in some content, good only while the lines there
        // still read as the write was planned from: the index's copy of
        // the row, or what the editor showed there. A line past the end
        // reads as nothing.
        let { line } = target;
        // A line the editor pointed at counts only in the content it was
        // taken in: in any other, a line reading as its text may be its twin.
        if (!('basis' in target)) {
            handed ??= contentKeyOf(before);
            if (target.key !== handed) return { kind: 'changed' };
        }
        if ('basis' in target) {
            // A row the index read counts only while the file reads as its
            // reading did, or carried across our own writes from there: in
            // any other content, a line reading as its basis may be its twin.
            // A copy that names no reading is not one the index read.
            if (target.read === undefined) return { kind: 'changed' };
            handed ??= contentKeyOf(before);
            const found = subjects.follow?.(target.read, line, handed) ?? null;
            if (found === null) return { kind: 'changed' };
            line = found;
        }
        if (!Number.isInteger(line) || line < 0 || line >= before.length) return { kind: 'changed' };
        let holds: boolean;
        if (!('basis' in target)) {
            const shown: RowBasis = { text: target.text, ...(target.subtree ? { subtree: target.subtree } : {}) };
            holds = readsAsPlanned(readBefore(), line, shown);
        } else {
            holds = readsAsPlanned(readBefore(), line, target.basis);
        }
        return holds ? line : { kind: 'changed' };
    };
    const session: WriteSession = {
        row: (target) => {
            const about = subjectOf(target);
            lastSubject = about;
            subjects.asked?.(about);
            let found = answered.get(target);
            if (found === undefined) {
                found = answer(target);
                answered.set(target, found);
            }
            if (typeof found !== 'number') { refuse(found, about); return null; }
            if (reported.length === 0) return found;
            const now = carry(found);
            if (now === null) { refuse({ kind: 'gone' }, about); return null; }
            return now;
        },
    };
    const notWritten = (): EditedLines => ({ written: false, refused: refused! });
    // A caller's bug, not the user's: a development build throws so the
    // bug is seen, a release build writes nothing and refuses.
    const callerBug = (what: string, reason: RefusalReason): EditedLines => {
        const message = `[FileLines] ${path}: ${what}; nothing written`;
        if (__DEV__) throw new BrokenWrite(message);
        logError(message, { notice: false });
        refuse(reason, subject());
        return notWritten();
    };
    let next: string[] | null;
    try {
        next = edit(draft, eol, session) ? working : null;
    } catch (error) {
        if (!(error instanceof LineBreakInLine) && !(error instanceof UnfollowableDraft)) throw error;
        // The input should have been refused where it came in
        // (`TaskApi`), not written with a line the report cannot count.
        return callerBug(error.message, { kind: 'failed' });
    }

    // A write that took a coordinate across its own edits wrote where
    // its report said the row had gone. If the report does not account
    // for the lines, that coordinate is not known to be the row's, and
    // nothing is written rather than something in the wrong place.
    if (unsound === null && next !== null && carried && !explains(before, next, reported)) {
        unsound = 'its report does not account for the lines it wrote';
    }
    if (unsound !== null) return callerBug(`a coordinate was carried across this write's edits, but ${unsound}`, { kind: 'changed' });
    if (next === null) {
        // A callback gives a write up by `row` answering null, which
        // says why. One that just returns false has not, and would
        // leave its caller a write neither made nor refused.
        return refused === null ? callerBug('a write was given up without a reason', { kind: 'failed' }) : notWritten();
    }

    // Every write is held to what it says it did, the same way: the
    // lines it put in read as put, and every other line as it did
    // (`checkWrite`). A write that reported nothing is not asked: one
    // that changed lines behind the draft is written with the chain
    // marked broken (W1's contract, `ChainMarks.vault.test.ts`).
    let readings: { read: OutlineReading; left: OutlineReading } | undefined;
    if (reported.length > 0) {
        const written = writtenLines(before.length, reported, placedBy);
        if (written === null || written.length !== next.length) {
            return callerBug('its report does not account for the lines it wrote', { kind: 'failed' });
        }
        // The reading of the lines as written is the note's next
        // reading, once the write lands; read here once, for the check
        // and for the rows the write leaves.
        readings = { read: readBefore(), left: Outline.read(next) };
        const check = checkWrite(readings.read, readings.left, written, puts);
        if (check === 'loose') return callerBug('a line was spliced into the body without a place (`LineDraft.put`)', { kind: 'failed' });
        if (check !== 'sound') {
            refuse({ kind: check }, subject());
            return notWritten();
        }
    }

    return { written: true, before, lines: next, edits: reported, reading: readings?.left ?? null };
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
 * What the write does to the lines, and whether it is made, is
 * {@link editLines}: where its target stands is asked of the `channel`
 * (`WriteSession.row`), and the write is held to its draft's report
 * (`checkWrite`). A refusal is handed to the channel once `vault.process` is
 * over — once, however many times Obsidian ran the callback. With no channel
 * there is nobody to ask, and every target is `gone`: the index that would
 * answer has been taken down.
 *
 * What the write left is handed to the channel once it landed
 * ({@link WriteChannel.landed}), with its report when the report accounts for
 * every line it left unreported; one that does not is logged and handed over
 * as null. Anything a write owes the rest of the plugin belongs on the
 * written branch only, and after `vault.process`: a write that never landed
 * leaves nothing behind.
 */
export async function processLines(
    app: App,
    file: TFile,
    channel: WriteChannel | undefined,
    edit: (draft: LineDraft, eol: Eol, session: WriteSession) => boolean,
    about?: string,
): Promise<WriteOutcome> {
    let refused: Refusal | null = null;
    // What the write left, when it changed the file: handed to the channel
    // once it is known to have landed.
    let landing: Landing | null = null;
    // What the write is about, for a refusal said after the callback is over.
    let lastSubject = '';
    const subject = () => lastSubject || about || file.path;

    const threw = await processOrFail(app, file, channel, attempt, subject);
    if (threw) return threw;

    // Set inside the callback, which the compiler does not follow.
    const outcome = refused as Refusal | null;
    if (outcome !== null) {
        channel?.refused(outcome);
        return { written: false, refused: outcome };
    }
    // Set inside the callback too.
    const landed = landing as Landing | null;
    if (landed !== null) channel?.landed(landed);
    return { written: true, refused: null };

    /** One run of the callback: the content to write, or the content as it was. */
    function attempt(content: string): string {
        // Obsidian may run the callback again (it retries on a conflicting
        // write). Only the last attempt is the one written.
        refused = null;
        landing = null;
        lastSubject = '';
        // Asked with the lines in hand: the reading the write starts from.
        const handed = channel?.reading();

        const { lines, eol, bom } = splitLines(content);
        const edited = editLines(file.path, lines, eol, edit, {
            about,
            asked: (said) => { lastSubject = said; },
            follow: channel ? (read, line, now) => channel.follow(read, line, now) : undefined,
        });
        if (!edited.written) {
            refused = edited.refused;
            return content;
        }
        const { before, lines: next, edits: reported } = edited;
        // The mark the note opened with, put back where it was.
        const rebuilt = (bom ? BOM : '') + joinLines([...next], eol);

        // A rewrite that produced the same bytes is not a write: Obsidian
        // fires no `modify` for it, and there is nothing new to read. The
        // caller still hears `true` — the line was found, which is what it
        // asked.
        if (rebuilt !== content) {
            const accounted = explains(before, next, reported);
            if (!accounted) {
                logError(`[FileLines] ${file.path}: a write's report does not account for the lines it wrote; landed without it`);
            }
            // Handed to nobody without a channel.
            if (handed) landing = { before, lines: next, edits: accounted ? reported : null, reading: edited.reading, handed };
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
 * left it, the write landed (null). Otherwise the file never changed.
 *
 * This is the one place that decides whether a write landed, and so whether
 * what it left is handed on ({@link WriteChannel.landed}). The file only
 * answers for this write while no other write of ours has touched it since,
 * so writes to one file run here one at a time, the reading back included.
 */
function processOrFail(
    app: App,
    file: TFile,
    channel: WriteChannel | undefined,
    attempt: (content: string) => string,
    subject: () => string,
): Promise<WriteRefused | null> {
    const ahead = inLine.get(file);
    const run = () => processAndSettle(app, file, channel, attempt, subject);
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
        if (error instanceof BrokenWrite) throw error;
        if (handedBack !== null && await readsAs(app, file, handedBack)) {
            logWarn(`[FileLines] ${file.path}: the write reported a failure, but the file reads as written; kept: ${String(error)}`);
            return null;
        }
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
 * These writes do not queue with the ones to notes already there (see
 * {@link processOrFail}): there was no note for another write to change.
 */
export async function createFile(
    app: App,
    path: string,
    channel: WriteChannel | undefined,
    subject: string,
    content: () => string | Promise<string>,
): Promise<WriteRefused | (WriteMade & { file: TFile })> {
    let asked: string | null = null;
    let handed: ReadMark | undefined;
    try {
        asked = await content();
        handed = channel?.reading();
        const file = await app.vault.create(path, asked);
        if (channel && handed) channel.landed({ before: [], lines: splitLines(asked).lines, edits: null, reading: null, handed });
        return { written: true, refused: null, file };
    } catch (error) {
        const made = app.vault.getAbstractFileByPath(path);
        if (!(asked !== null && made instanceof TFile && await readsAs(app, made, asked))) {
            return writeFailed(channel, path, subject, error);
        }
        logWarn(`[FileLines] ${path}: creating the note reported a failure, but it reads as written; kept: ${String(error)}`);
        if (channel && handed) channel.landed({ before: [], lines: splitLines(asked).lines, edits: null, reading: null, handed });
        return { written: true, refused: null, file: made };
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

/**
 * Replace a file's content whole — one atomic `vault.process` — for a writer
 * that builds the file from scratch rather than editing its lines (a saved
 * template).
 *
 * Such a write cannot say which line became which, so it lands with no
 * report. A write that changes nothing is no write, as in
 * {@link processLines}.
 */
export async function replaceWhole(
    app: App,
    file: TFile,
    channel: WriteChannel | undefined,
    content: string,
): Promise<WriteOutcome> {
    let landing: Landing | null = null;
    const threw = await processOrFail(app, file, channel, (current) => {
        landing = null;
        if (current === content) return current;
        if (channel) landing = { before: splitLines(current).lines, lines: splitLines(content).lines, edits: null, reading: null, handed: channel.reading() };
        return content;
    }, () => file.path);
    if (threw) return threw;
    // Set inside the callback, which the compiler does not follow.
    const landed = landing as Landing | null;
    if (landed !== null) channel?.landed(landed);
    return { written: true, refused: null };
}
