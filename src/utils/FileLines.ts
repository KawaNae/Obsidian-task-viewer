import type { App, TFile } from 'obsidian';
import type { Hint } from '../services/core/identity/IdentityHints';

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
 * Anything a write owes the rest of the plugin — the self-write identity hints
 * of stage 2 among them — belongs on the written branch only. A hint left
 * behind by a write that never happened would be consumed by the next scan of
 * that file and hand some other line the wrong identity.
 */
export async function processLines(
    app: App,
    file: TFile,
    edit: (lines: string[], eol: Eol, hint: (claim: Hint) => void) => string[] | null,
    sink?: (hints: readonly Hint[]) => () => void,
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
            const collected: Hint[] = [];
            const next = edit(lines, eol, claim => collected.push(claim));
            if (next === null) return content;

            written = true;
            const rebuilt = joinLines(next, eol);

            // A rewrite that produced the same bytes is not a write: Obsidian
            // fires no `modify` for it, so no scan follows, and a hint filed
            // here would wait for a scan that never comes. The caller still
            // hears `true` — the line was found, which is what it asked.
            //
            // Hints are handed over here rather than after the `await` on
            // purpose: the scan this write triggers starts reading before
            // `vault.process` resolves, so a hint raised afterwards is too late
            // for it. Filing early means filing before the write is known to
            // have succeeded, which is what the withdrawal below is for.
            if (sink && collected.length > 0 && rebuilt !== content) {
                withdrawals.push(sink(collected));
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
