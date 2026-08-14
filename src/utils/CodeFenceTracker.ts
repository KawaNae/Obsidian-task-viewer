/**
 * Tracks fenced code blocks (``` / ~~~) across sequential lines.
 * Used to exclude fenced content from heading / list detection.
 */
export class CodeFenceTracker {
    private fence: { char: string; length: number } | null = null;

    /**
     * Feed the next line. Returns true if the line belongs to a code fence
     * (opening and closing delimiter lines included).
     */
    feed(line: string): boolean {
        if (this.fence) {
            const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
            if (close && close[1][0] === this.fence.char && close[1].length >= this.fence.length) {
                this.fence = null;
            }
            return true;
        }
        const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (open) {
            // CommonMark: a backtick fence's info string cannot contain backticks
            if (open[1][0] === '`' && line.slice(open[0].length).includes('`')) return false;
            this.fence = { char: open[1][0], length: open[1].length };
            return true;
        }
        return false;
    }

    /** Per-line fence membership for a whole document. */
    static mask(lines: string[]): boolean[] {
        const tracker = new CodeFenceTracker();
        return lines.map((line) => tracker.feed(line));
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
        const tracker = new CodeFenceTracker();
        return lines.map((line) => tracker.feed(line.trimStart()));
    }
}
