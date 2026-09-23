import type { App, TFile } from 'obsidian';
import { logError } from '../log/log';

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
 * Split file content into lines, dropping the CR of a CRLF terminator.
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
    const lines = (bom ? content.slice(BOM.length) : content).split('\n');
    const terminators = lines.length - 1;
    let crlf = 0;

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].endsWith('\r')) continue;
        // Always off the text. A CR the parser can see is a CR the parser
        // refuses: its line regex ends at `$` and `.` does not match CR, so a
        // line carrying one is not read as a task at all.
        lines[i] = lines[i].slice(0, -1);
        // Only the lines that have a terminator get a vote. The last element
        // has none, and letting its stray CR count would rewrite an entire LF
        // file to CRLF on the next write.
        if (i < terminators) crlf++;
    }

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
        splice: edits.splice,
        rewrite: (at, text) => {
            lines[at] = text;
            edits.replaced(at);
        },
        carry: edits.carry,
    };
    return { draft, reported };
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
    /** For a write that reported and then failed, or whose callback ran again. */
    withdraw: () => void;
    /**
     * The rows the report named on the spot. Empty when nothing was claimed —
     * a name is only worth handing out when the scan that adopts the claim
     * gives the row that same one.
     */
    made: readonly MadeRow[];
}

/** Where a write's report goes. */
export type WriteSink = (
    before: readonly string[],
    after: readonly string[],
    edits: readonly LineEdit[],
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
 * `edited` says the row's line reads as nothing the plugin has on record for
 * that row — not as the last scan read it, nor as any write of ours left it.
 * Something else rewrote the line after the index last saw it. Matching may
 * still pair the row there — the ladder's last rung pairs one leftover against
 * one on a shared date alone — but a row whose text changed under it is a
 * guess about which task that is, and what the index holds of it is out of
 * date either way. `WriteSession.lineOf` refuses it as `changed`; the next
 * scan reads the edit, and the write can be made again.
 */
export type Located =
    | { kind: 'at'; line: number; edited: boolean }
    | { kind: 'ambiguous'; count: number }
    | { kind: 'gone' };

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
 * longer reads what the caller saw there, or what it would write has nowhere
 * in the body to go (see `Placement`).
 */
export type RefusalReason =
    | { kind: 'ambiguous'; count: number }
    | { kind: 'gone' }
    | { kind: 'changed' }
    | { kind: 'unplaceable' };

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
    refused(refusal: Refusal): void;
}

/**
 * What one `processLines` callback is handed besides its draft: the question
 * of where its target stands, and the way to give the write up.
 *
 * `locate` answers once per name, about the lines as they were handed in: that
 * is the one content the plugin can have on record, so it is the one the
 * question can be put to. Asked again, it carries that answer across the
 * edits this write has reported since, and across nothing else — every line
 * the write moved, it moved through its draft, and the report is the whole of
 * what happened to the lines in between. A line the write took away is
 * `gone`. So one write can apply several effects to one row without asking
 * the file a second time, which is where a coordinate would go stale.
 *
 * The carrying is checked, because it is only as good as the report: a line
 * the report does not say was rewritten has to read what it read, and a write
 * that carried a coordinate is refused whole if its report does not account
 * for the lines it returns.
 */
export interface WriteSession {
    locate(ref: TaskRef): Located;
    /**
     * The target's line, or null when it has none — in which case the write is
     * refused, and the callback returns false. A line something else edited
     * since the index read it (`edited`) is refused too, as `changed`.
     */
    lineOf(ref: TaskRef, subject: string): number | null;
    /** Give the write up: nothing is written, and the refusal is told once it is over. */
    refuse(reason: RefusalReason, subject: string): false;
}

/** What became of one `processLines`. */
export interface WriteOutcome {
    /** Whether the callback said to write, whether or not the lines differed. */
    written: boolean;
    /** Why it did not, when it gave the write up. */
    refused: Refusal | null;
    /**
     * The rows the write made, by the names the next scan gives them if it
     * adopts this write's claim. Empty when the write claimed nothing (see
     * {@link WriteReceipt.made}); the names of a claim no scan adopts go
     * with it, and are never given to any line.
     */
    made: readonly MadeRow[];
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
 * names its target and `locate` answers where that target stands in these
 * lines. A write whose target has no line gives up through `session.refuse`,
 * and the refusal is handed to the channel once `vault.process` is over —
 * once, however many times Obsidian ran the callback. With no channel there is
 * nobody to ask, and every target is `gone`: the index that would answer has
 * been taken down.
 *
 * Every change `edit` makes goes through the {@link LineDraft} it is handed,
 * which reports it, and that report is what lets the next scan know which
 * line is which. A report that does not account for the file it produced is
 * logged and dropped. The write itself still lands — the report is
 * bookkeeping, and losing a user's edit over bookkeeping would be the worse
 * failure by far.
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
    let written = false;
    let refused: Refusal | null = null;
    let made: readonly MadeRow[] = [];
    const sink = channel?.sink;
    // A list rather than one slot: `vault.process` may run the callback again,
    // and everything filed has to be withdrawable.
    const withdrawals: Array<() => void> = [];

    try {
        await app.vault.process(file, (content) => {
            // Obsidian may run the callback again (it retries on a conflicting
            // write). The previous attempt's claims describe a file that never
            // reached disk, so they go before this attempt files its own.
            for (const withdraw of withdrawals.splice(0)) withdraw();
            refused = null;
            made = [];

            const { lines, eol, bom } = splitLines(content);
            const before = [...lines];
            // Over `lines` itself: every change the write makes, it makes to
            // this array through the draft, and the draft reports it.
            const { draft, reported } = draftOver(lines);
            const refuse = (reason: RefusalReason, subject: string): false => {
                refused = { file: file.path, reason, subject };
                return false;
            };
            // Each name is asked once, of the lines as they were handed in.
            const answered = new Map<string, Located>();
            // Whether a coordinate was carried across this write's own edits,
            // and whether carrying one caught the report out.
            let carried = false;
            let unsound: string | null = null;
            const carry = (at: Extract<Located, { kind: 'at' }>): Located => {
                carried = true;
                const replayed = replayEdits(before.length, reported);
                const now = replayed?.origin.indexOf(at.line) ?? -1;
                if (!replayed) {
                    unsound = 'a report no file could follow';
                    return { kind: 'gone' };
                }
                // Taken away by this very write: the row is not on these lines.
                if (now < 0) return { kind: 'gone' };
                if (!replayed.rewritten[now] && lines[now] !== before[at.line]) {
                    unsound = `line ${at.line} carried to ${now} does not read what it read`;
                    return { kind: 'gone' };
                }
                return { ...at, line: now };
            };
            const locate = (ref: TaskRef): Located => {
                let found = answered.get(ref.runtimeId);
                if (found === undefined) {
                    found = channel ? channel.locate(before, ref) : { kind: 'gone' };
                    answered.set(ref.runtimeId, found);
                }
                return found.kind === 'at' && reported.length > 0 ? carry(found) : found;
            };
            let lastSubject = '';
            const session: WriteSession = {
                locate,
                lineOf: (ref, subject) => {
                    lastSubject = subject;
                    const located = locate(ref);
                    if (located.kind !== 'at') { refuse(located, subject); return null; }
                    if (located.edited) { refuse({ kind: 'changed' }, subject); return null; }
                    return located.line;
                },
                refuse,
            };
            const next = edit(draft, eol, session) ? lines : null;

            // A write that took a coordinate across its own edits wrote where
            // its report said the row had gone. If the report does not account
            // for the lines, that coordinate is not known to be the row's, and
            // nothing is written rather than something in the wrong place.
            if (unsound === null && next !== null && carried && !explains(before, next, reported)) {
                unsound = 'its report does not account for the lines it wrote';
            }
            if (unsound !== null) {
                const message = `[FileLines] ${file.path}: a coordinate was carried across this write's edits, but ${unsound}; nothing written`;
                if (__DEV__) throw new Error(message);
                logError(message);
                refuse({ kind: 'changed' }, lastSubject);
                return content;
            }
            if (next === null) return content;
            refused = null;

            written = true;
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
            if (sink && reported.length > 0 && rebuilt !== content) {
                if (explains(before, next, reported)) {
                    const receipt = sink(before, next, reported);
                    withdrawals.push(receipt.withdraw);
                    made = receipt.made;
                } else {
                    logError(`[FileLines] ${file.path}: a write's report does not account for the lines it wrote; no claim filed`);
                }
            }

            return rebuilt;
        });
    } catch (error) {
        // The file never changed, so claims about it describe a state that
        // never existed. Left in the log they would be matched against whatever
        // the next scan happens to read.
        for (const withdraw of withdrawals) withdraw();
        throw error;
    }

    // Set inside the callback, which the compiler does not follow.
    const outcome = refused as Refusal | null;
    if (outcome !== null) channel?.refused(outcome);
    return { written, refused: outcome, made };
}
