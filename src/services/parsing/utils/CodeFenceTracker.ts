/**
 * The delimiter lines of fenced code blocks (``` / ~~~): whether a line
 * opens one, and whether it closes the one another opened.
 *
 * Which lines are code, and where a fence begins and ends, is the outline's
 * question (`Outline.read`), which asks these of each line at the column
 * its reading measures from.
 */

/** A fence's opening delimiter: which character, how many of it, and the info string. */
export interface FenceDelimiter {
    char: string;
    length: number;
    info: string;
}

const DELIMITER_RE = /^(`{3,}|~{3,})/;
const CLOSING_RE = /^(`{3,}|~{3,})[ \t]*$/;

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
}
