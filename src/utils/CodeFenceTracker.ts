/**
 * The delimiter lines of fenced code blocks (``` / ~~~): whether a line
 * opens one, and whether it closes the one another opened.
 *
 * Which lines are code, and where a fence begins and ends, is the outline's
 * question (`Outline.read`), which asks these of each line at the column
 * its reading measures from. The one other reader is `Placement.closesItsFences`
 * (`feed` / `isInside`), which reads a block to be written on its own.
 */

/** A fence's opening delimiter: which character, how many of it, and the info string. */
export interface FenceDelimiter {
    char: string;
    length: number;
    info: string;
}

const DELIMITER_RE = /^(`{3,}|~{3,})/;
const CLOSING_RE = /^(`{3,}|~{3,})[ \t]*$/;

const OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;

export class CodeFenceTracker {
    /**
     * The opening delimiter `text` is, or null. `text` is a line with its
     * indentation taken off; whether that indentation lets it open a fence
     * at all is the outline's question (`Outline.read`), not this one's.
     * CommonMark: a backtick fence's info string cannot contain backticks.
     */
    static opening(text: string): FenceDelimiter | null {
        const m = DELIMITER_RE.exec(text);
        if (!m) return null;
        const info = text.slice(m[0].length);
        if (m[1][0] === '`' && info.includes('`')) return null;
        return { char: m[1][0], length: m[1].length, info: info.trim() };
    }

    /** Whether `text`, its indentation taken off, closes the fence `open` opened. */
    static closes(text: string, open: FenceDelimiter): boolean {
        const m = CLOSING_RE.exec(text);
        return m !== null && m[1][0] === open.char && m[1].length >= open.length;
    }

    private fence: { char: string; length: number } | null = null;

    /**
     * Feed the next line, read from column 0. Returns true if the line
     * belongs to a code fence (opening and closing delimiter lines included).
     */
    feed(line: string): boolean {
        if (this.fence) {
            const close = line.match(CLOSE_RE);
            if (close && close[1][0] === this.fence.char && close[1].length >= this.fence.length) {
                this.fence = null;
            }
            return true;
        }
        const m = line.match(OPEN_RE);
        if (m && CodeFenceTracker.opening(line.slice(m[0].length - m[1].length))) {
            this.fence = { char: m[1][0], length: m[1].length };
            return true;
        }
        return false;
    }

    /** True while inside a fence (after the opening delimiter was fed). */
    isInside(): boolean {
        return this.fence !== null;
    }
}
