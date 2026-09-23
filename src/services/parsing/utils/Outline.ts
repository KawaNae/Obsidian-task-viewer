/**
 * What the lines of a note are to each other: how deep a line is, where a
 * task's subtree ends, where the body begins.
 *
 * The parser and the writers ask these questions of the same lines, and each
 * used to answer them with a copy of its own. Two copies are two answers: a
 * write that carries lines the index does not read as children, or places a
 * line where the index does not read the body, is a write the next scan reads
 * differently from how it was meant. Every reading of the outline goes
 * through here, so there is one.
 */
export class Outline {
    /**
     * The line's depth: the width its indentation shows at, a tab reaching the
     * next multiple of four columns (CommonMark's tab stop).
     *
     * Width, not a count of characters: a note that indents with tabs in one
     * place and four spaces in another writes the same depth two ways, and
     * counting characters makes the tab line look shallower — a child reads
     * as a sibling, a sibling as its elder's child, and the parser and every
     * write disagree with what the note shows.
     */
    static depthOf(line: string): number {
        let width = 0;
        for (const ch of this.indentOf(line)) {
            width = ch === '\t' ? width + 4 - (width % 4) : width + 1;
        }
        return width;
    }

    /**
     * The line's indentation as written: the spaces and tabs it opens with,
     * and nothing else. A byte order mark or a non-breaking space is text.
     */
    static indentOf(line: string): string {
        return /^[ \t]*/.exec(line)![0];
    }

    /**
     * The index just past `row`'s subtree: the lines below it that are deeper
     * than it, stopping at the first blank line, the first line no deeper than
     * the row, or `limit`.
     */
    static subtreeEnd(lines: readonly string[], row: number, limit: number = lines.length): number {
        const depth = this.depthOf(lines[row]);
        let end = row + 1;
        while (end < limit) {
            const line = lines[end];
            if (line.trim() === '') break;
            if (this.depthOf(line) <= depth) break;
            end++;
        }
        return end;
    }

    /**
     * The index of the body's first line: past the frontmatter when the note
     * opens with one, 0 otherwise. A `---` on the first line that nothing
     * closes opens no frontmatter.
     */
    static bodyStart(lines: readonly string[]): number {
        if (lines.length === 0 || lines[0].trim() !== '---') return 0;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') return i + 1;
        }
        return 0;
    }
}
