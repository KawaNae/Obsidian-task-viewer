import type { App, TFile } from 'obsidian';

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

    // Only the lines that have a terminator can say what the terminator is.
    // The last element has none — a CR at its end is a character the file
    // happens to end with, and counting it as evidence would let one stray CR
    // rewrite an entire LF file (and take that CR with it).
    const terminators = lines.length - 1;
    let crlf = 0;
    for (let i = 0; i < terminators; i++) {
        if (lines[i].endsWith('\r')) {
            lines[i] = lines[i].slice(0, -1);
            crlf++;
        }
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
    edit: (lines: string[], eol: Eol) => string[] | null,
): Promise<boolean> {
    let written = false;

    await app.vault.process(file, (content) => {
        const { lines, eol } = splitLines(content);
        const next = edit(lines, eol);
        if (next === null) return content;
        written = true;
        return joinLines(next, eol);
    });

    return written;
}
