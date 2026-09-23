import { CodeFenceTracker } from '../../../utils/CodeFenceTracker';

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
     * The line's indentation as written: the whitespace it opens with, a byte
     * order mark excepted.
     *
     * The same whitespace the task-line reading accepts before a list marker
     * (`TaskLineClassifier`, `^\s*`), so a line read as an indented task is
     * read at the depth it is indented to, and a write that keeps a line's
     * indentation keeps all of it — a full-width space included. A byte order
     * mark is not indentation: it is the file's (`splitLines` takes it off),
     * and a mark read as indentation was copied onto every line written
     * beside the first.
     */
    static indentOf(line: string): string {
        return /^[^\S\uFEFF]*/.exec(line)![0];
    }

    /**
     * The index just past `row`'s subtree: the lines below it up to the first
     * line that is no deeper than the row, or `limit`.
     *
     * A blank line does not end it: a deeper line below a blank one is still
     * the row's (as it is to Markdown, where a list item's content goes on
     * past a blank line), and a subtree that stopped at the blank left that
     * line behind — an orphan after a delete, a child left where it was by a
     * move. The blank lines at the very end are not the row's, though: they
     * stand between it and whatever follows, and stay there.
     */
    static subtreeEnd(lines: readonly string[], row: number, limit: number = lines.length): number {
        const depth = this.depthOf(lines[row]);
        // A fence opened inside the subtree is the subtree's up to its closing
        // line, whatever the depth of the lines in it: the parser reads every
        // one of them as fenced (`CodeFenceTracker.mask`). An end in the middle
        // of it would leave half a fence behind a delete or a move — and the
        // closing line left alone opens a fence that swallows what follows.
        // The row itself is outside every fence, so a tracker started below it
        // reads the fences exactly as the whole-document reading does.
        const fence = new CodeFenceTracker();
        let end = row + 1;
        for (let i = row + 1; i < limit; i++) {
            const line = lines[i];
            if (fence.isInside()) {
                fence.feed(line);
                end = i + 1;
                continue;
            }
            if (line.trim() === '') continue;
            if (this.depthOf(line) <= depth) break;
            fence.feed(line);
            end = i + 1;
        }
        // A fence that never closes runs to the end of the note, and the
        // subtree does not go with it: taking it would take everything after.
        // The subtree is then read by depth alone, as if there were no fence.
        return fence.isInside() ? this.plainEnd(lines, row, depth, limit) : end;
    }

    /** {@link subtreeEnd} read without fences. */
    private static plainEnd(lines: readonly string[], row: number, depth: number, limit: number): number {
        let end = row + 1;
        for (let i = row + 1; i < limit; i++) {
            const line = lines[i];
            if (line.trim() === '') continue;
            if (this.depthOf(line) <= depth) break;
            end = i + 1;
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
