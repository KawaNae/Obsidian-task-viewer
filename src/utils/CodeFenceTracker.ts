/**
 * Tracks fenced code blocks (``` / ~~~) across sequential lines.
 * Used to exclude fenced content from heading / list detection.
 */

/** An opening delimiter and what it opened. */
export interface FenceOpen {
    /** Index of the opening delimiter line. */
    line: number;
    /** Index of the closing delimiter line; null when the fence never closes. */
    close: number | null;
    /** Info string after the delimiter, trimmed (`markdown`, `tv-gen 週報`, …). */
    info: string;
}

/** Per-line membership plus the delimiters that produced it. */
export interface FenceScan {
    /** True for every line inside a fence, both delimiters included. */
    fenced: boolean[];
    /**
     * Fences that actually open one, in document order. A delimiter written
     * INSIDE another fence is content, not an opener, so it never appears
     * here — which is what separates a real block from the same three
     * backticks quoted inside a wider example.
     */
    opens: FenceOpen[];
}

const OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;

export class CodeFenceTracker {
    private fence: { char: string; length: number } | null = null;

    /**
     * Feed the next line. Returns true if the line belongs to a code fence
     * (opening and closing delimiter lines included).
     */
    feed(line: string): boolean {
        if (this.fence) {
            const close = line.match(CLOSE_RE);
            if (close && close[1][0] === this.fence.char && close[1].length >= this.fence.length) {
                this.fence = null;
            }
            return true;
        }
        const open = CodeFenceTracker.matchOpen(line);
        if (open) {
            this.fence = { char: open.char, length: open.length };
            return true;
        }
        return false;
    }

    /** True while inside a fence (after the opening delimiter was fed). */
    isInside(): boolean {
        return this.fence !== null;
    }

    /**
     * An opening delimiter, or null. CommonMark: a backtick fence's info
     * string cannot contain backticks — which is also why a fence name
     * cannot contain one.
     */
    private static matchOpen(line: string): { char: string; length: number; info: string } | null {
        const m = line.match(OPEN_RE);
        if (!m) return null;
        const info = line.slice(m[0].length);
        if (m[1][0] === '`' && info.includes('`')) return null;
        return { char: m[1][0], length: m[1].length, info: info.trim() };
    }

    /**
     * Per-line fence membership plus the opening delimiters.
     *
     * The single implementation of "is this line inside a fence" and "does
     * this line open one". Callers that need to read a fenced block by its
     * info string (the `tv-gen` collector) must take the openers from here
     * rather than matching the delimiter themselves: only this walk knows
     * that a delimiter sitting inside a wider fence is quoted content.
     */
    static scan(lines: string[]): FenceScan {
        const tracker = new CodeFenceTracker();
        const fenced: boolean[] = [];
        const opens: FenceOpen[] = [];
        let current: FenceOpen | null = null;

        for (let i = 0; i < lines.length; i++) {
            const wasInside = tracker.isInside();
            fenced.push(tracker.feed(lines[i]));

            if (!wasInside && tracker.isInside()) {
                current = { line: i, close: null, info: this.matchOpen(lines[i])!.info };
                opens.push(current);
            } else if (wasInside && !tracker.isInside()) {
                if (current) current.close = i;
                current = null;
            }
        }

        return { fenced, opens };
    }

    /** Per-line fence membership for a whole document. */
    static mask(lines: string[]): boolean[] {
        return this.scan(lines).fenced;
    }

    /**
     * Fence membership *within a subtree*, where the fence markers carry the
     * list item's indentation. `feed` measures its ≤3-space allowance from
     * column 0 (CommonMark), so a fence nested under a task — the normal way
     * to write one in Obsidian — is invisible to {@link mask}. Feeding
     * dedented lines restores the relative reading.
     *
     * A subtree mask is only ever half the answer: the subtree may itself sit
     * inside a document-level fence. Callers OR the two together.
     */
    static subtreeMask(lines: string[]): boolean[] {
        return this.scan(lines.map(line => line.trimStart())).fenced;
    }
}
