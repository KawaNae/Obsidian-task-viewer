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
 * terminated note would open with a blank line.
 */
export function appendLines(lines: string[], body: string[]): number {
    const at = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    lines.splice(at, lines.length - at, ...body);
    return at;
}

/** One thing a write did to the file's lines, in the coordinates of the moment. */
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
 * `replaced` and a `removed` + `inserted` pair produce the same file, and the
 * check below cannot tell them apart: the lines come out identical either way.
 * Only the writer knows which it meant, and both mistakes cost something.
 * Saying `replaced` where a line was really torn down and rebuilt hands a new
 * task the old one's identity. Saying `removed` + `inserted` where a line was
 * only rewritten calls a row that is still there new, and the hub or the
 * selection holding it loses its task — the ladder would have kept it by
 * matching the text. So `replaced` means: this line still belongs to the same
 * task as before.
 */
export interface LineEdits {
    /** The line at `at` reads something else now, and is the same task. */
    replaced(at: number): void;
    /** `count` lines starting at `at` are lines this write created. */
    inserted(at: number, count: number): void;
    /** `count` lines starting at `at` are gone. */
    removed(at: number, count: number): void;
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
 * it from the `false` returned here instead of from a no-op it cannot tell
 * apart from success.
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
    edit: (lines: string[], eol: Eol, edits: LineEdits) => string[] | null,
    sink?: WriteSink,
): Promise<boolean> {
    let written = false;
    // A list rather than one slot: `vault.process` may run the callback again,
    // and everything filed has to be withdrawable.
    const withdrawals: Array<() => void> = [];

    try {
        await app.vault.process(file, (content) => {
            // Obsidian may run the callback again (it retries on a conflicting
            // write). The previous attempt's claims describe a file that never
            // reached disk, so they go before this attempt files its own.
            for (const withdraw of withdrawals.splice(0)) withdraw();

            const { lines, eol } = splitLines(content);
            const before = [...lines];
            const reported: LineEdit[] = [];
            const next = edit(lines, eol, {
                replaced: (at) => reported.push({ kind: 'replaced', at }),
                inserted: (at, count) => reported.push({ kind: 'inserted', at, count }),
                removed: (at, count) => reported.push({ kind: 'removed', at, count }),
            });
            if (next === null) return content;

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

    return written;
}
