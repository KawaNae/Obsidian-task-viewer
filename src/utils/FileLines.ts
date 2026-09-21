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
}

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
    const lines = content.split('\n');
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

    return { lines, eol: crlf > terminators - crlf ? '\r\n' : '\n' };
}

/** Put the lines back together with the terminator the file is written in. */
export function joinLines(lines: string[], eol: Eol): string {
    return lines.join(eol);
}

/**
 * Append `body` to `lines` and answer the index its first line landed on.
 *
 * A file that ends with a terminator has an empty last element, and the body
 * replaces it instead of following it — otherwise every append to a normally
 * terminated note would open with a blank line. That replacement is why an
 * append reports through {@link LineEdits} rather than as a plain insert: the
 * empty element is a line of the array like any other, and a report that left
 * it out would not account for the file.
 *
 * `edits` has to be the one built over *this* array (see {@link recordEdits}).
 */
export function appendLines(lines: string[], body: string[], edits?: LineEdits): number {
    const at = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    if (edits) edits.splice(at, lines.length - at, ...body);
    else lines.splice(at, lines.length - at, ...body);
    return at;
}

/**
 * One thing a write did to the file's lines, in the coordinates of the moment.
 *
 * Internal to this module and the replay: a writer never builds one. It says
 * what it did through {@link LineEdits}, which is the only thing that produces
 * these, so the numbers in a report always come from the splice that moved the
 * lines rather than from a second reading of the same intention.
 */
export type LineEdit =
    | { kind: 'replaced'; at: number }
    | { kind: 'inserted'; at: number; count: number }
    | { kind: 'removed'; at: number; count: number };

/**
 * What a write tells the index it did, so the next scan can be told which line
 * is which.
 *
 * Each call describes one operation in the line numbers as they stand *at that
 * moment* — report right after doing it, and a run of edits reads back in the
 * order it happened.
 *
 * A rewrite and a tear-down-and-rebuild produce the same file, and the check
 * below cannot tell them apart: the lines come out identical either way.
 * Only the writer knows which it meant, and both mistakes cost something.
 * Saying {@link replaced} where a line was really torn down and rebuilt hands a
 * new task the old one's identity. Splicing a line away and a new one in where
 * it was only rewritten calls a row that is still there new, and the hub or the
 * selection holding it loses its task — the ladder would have kept it by
 * matching the text. So `replaced` means: this line still belongs to the same
 * task as before.
 *
 * There are only these two, and a splice is the only way to add or remove a
 * line. A writer that could say "three lines went in at 7" beside a splice that
 * put them at 6 is a writer that can be wrong about the one thing this
 * mechanism exists to get right.
 */
export interface LineEdits {
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
}

/**
 * A {@link LineEdits} over one array of lines, and the report it fills in.
 *
 * `processLines` builds this over the lines it is about to hand a write, and a
 * test builds it over the lines it passes in, so both run the same arithmetic
 * instead of a copy of it.
 */
export function recordEdits(lines: string[]): { edits: LineEdits; reported: LineEdit[] } {
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
    };
    return { edits, reported };
}

/** Where `Array.prototype.splice` starts, given what it was passed. */
function spliceStart(length: number, at: number): number {
    const n = Number.isNaN(at) ? 0 : Math.trunc(at);
    return n < 0 ? Math.max(length + n, 0) : Math.min(n, length);
}

/**
 * Where a write's report goes. Answers a handle that takes it back, for a
 * write that reported and then failed.
 */
export type WriteSink = (
    before: readonly string[],
    after: readonly string[],
    edits: readonly LineEdit[],
) => () => void;

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
 * Something else rewrote the line after the index last saw it. The row is
 * still this one; what the index holds of its text is not. A write that
 * rebuilds the whole line from the index's copy would put back what the edit
 * took out, and refuses (see `WriteSession.lineOf`).
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
 * apart, it is on no line of the file, or the line the caller pointed at no
 * longer reads what the caller saw there.
 */
export type RefusalReason =
    | { kind: 'ambiguous'; count: number }
    | { kind: 'gone' }
    | { kind: 'changed' };

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
    /** Absent for a write that must not claim anything (see `deleteTaskFromFile`). */
    sink?: WriteSink;
    locate(lines: readonly string[], ref: TaskRef): Located;
    refused(refusal: Refusal): void;
}

/**
 * What one `processLines` callback is handed besides the lines: the report of
 * its edits, and the question of where its target stands.
 *
 * `locate` answers about the lines as they were handed in. A callback asks
 * before it edits: once it has spliced, the lines are a content nothing is on
 * record for, and a coordinate from before the splice would have to be carried
 * across it — which is exactly what the question exists to avoid.
 */
export interface WriteSession {
    edits: LineEdits;
    locate(ref: TaskRef): Located;
    /**
     * The target's line, or null when it has none — in which case the write is
     * refused, and the callback returns the null this gives back.
     *
     * With `rewrites`, a line something else has edited since the index read
     * it (`edited`) is refused too, as `changed`: the write is about to
     * replace the line with one built from the index's copy of the row.
     */
    lineOf(ref: TaskRef, subject: string, opts?: { rewrites?: boolean }): number | null;
    /** Give the write up: nothing is written, and the refusal is told once it is over. */
    refuse(reason: RefusalReason, subject: string): null;
}

/** What became of one `processLines`. */
export interface WriteOutcome {
    /** Whether the callback returned lines, whether or not they differed. */
    written: boolean;
    /** Why it did not, when it gave the write up. */
    refused: Refusal | null;
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
 * an index outside the file, a removal running past the end. Callers treat
 * that the same as no report at all.
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
        }
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
 * Read a file as lines, let `edit` rewrite them, and write it back with the
 * file's own terminator — one atomic `vault.process`.
 *
 * `edit` returns null to write nothing at all: the file is left
 * byte-identical, Obsidian fires no `modify`, and no rescan follows. That is
 * the whole contract for a write that could not be placed. The caller learns
 * it from `written: false` instead of from a no-op it cannot tell apart from
 * success.
 *
 * Where to write is asked of the `channel`, through the session: a write
 * names its target and `locate` answers where that target stands in these
 * lines. A write whose target has no line gives up through `session.refuse`,
 * and the refusal is handed to the channel once `vault.process` is over —
 * once, however many times Obsidian ran the callback. With no channel there is
 * nobody to ask, and every target is `gone`: the index that would answer has
 * been taken down.
 *
 * `edit` may also report what it did to the lines, through the {@link
 * LineEdits} it is handed, and that report is what lets the next scan know
 * which line is which. Reporting is per write site and optional: a write that
 * says nothing is a write the scan works out for itself, as every write did
 * before stage 2. A write that says *something* has to say everything, and a
 * report that does not account for the file it produced is logged and dropped.
 * The write itself still lands — the report is bookkeeping, and losing a user's
 * edit over bookkeeping would be the worse failure by far.
 *
 * Anything a write owes the rest of the plugin belongs on the written branch
 * only. A claim left behind by a write that never happened would be weighed by
 * the next scan of that file against something else entirely.
 */
export async function processLines(
    app: App,
    file: TFile,
    edit: (lines: string[], eol: Eol, session: WriteSession) => string[] | null,
    channel?: WriteChannel,
): Promise<WriteOutcome> {
    let written = false;
    let refused: Refusal | null = null;
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

            const { lines, eol } = splitLines(content);
            const before = [...lines];
            // Over `lines` itself: a report describes the array the write was
            // handed. A write that returns some other array is not reporting
            // about the file it wrote, and the check below refuses it.
            const { edits, reported } = recordEdits(lines);
            const refuse = (reason: RefusalReason, subject: string): null => {
                refused = { file: file.path, reason, subject };
                return null;
            };
            const locate = (ref: TaskRef): Located => {
                if (__DEV__ && reported.length > 0) {
                    throw new Error(`[FileLines] ${file.path}: locate asked after the lines were edited`);
                }
                return channel ? channel.locate(before, ref) : { kind: 'gone' };
            };
            const session: WriteSession = {
                edits,
                locate,
                lineOf: (ref, subject, opts) => {
                    const located = locate(ref);
                    if (located.kind !== 'at') return refuse(located, subject);
                    if (opts?.rewrites && located.edited) return refuse({ kind: 'changed' }, subject);
                    return located.line;
                },
                refuse,
            };
            const next = edit(lines, eol, session);
            if (next === null) return content;
            refused = null;

            written = true;
            const rebuilt = joinLines(next, eol);

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
                    withdrawals.push(sink(before, next, reported));
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
    return { written, refused: outcome };
}
