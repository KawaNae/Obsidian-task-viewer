import { CodeFenceTracker } from '../../../utils/CodeFenceTracker';
import { SPACE_OR_TAB_SOURCE } from './ListMarker';

/**
 * Indentation, as a regex fragment: the tabs and spaces a line opens with.
 *
 * Only these two, because only these two nest a list item in Obsidian. A line
 * opened with a full-width space (U+3000) or a no-break space (U+00A0) is not
 * a list item to it at all: its metadata reads the line as the item above
 * going on (R0). `\s` took both for indentation, and U+2028 and a byte order
 * mark besides, so such a line was read as a child the note does not have.
 *
 * Every reading of a line's indentation — the task, child, flow and property
 * line patterns, the depth, and the writes that keep or strip a line's
 * indentation — is made of this one.
 */
export const INDENT_SOURCE = `${SPACE_OR_TAB_SOURCE}*`;

const INDENT_RE = new RegExp(`^${INDENT_SOURCE}`);

/**
 * A way two lines of a note can be the same line: two lines stand in it when
 * their keys are equal. `key` is what a collection of lines is keyed by, and
 * `holds` is only ever `key(a) === key(b)`, so the two cannot disagree.
 */
export interface LineRelation {
    key(line: string): string;
    holds(a: string, b: string): boolean;
}

function relation(key: (line: string) => string): LineRelation {
    return { key, holds: (a, b) => key(a) === key(b) };
}

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
     * The line's indentation as written: the tabs and spaces it opens with
     * (`INDENT_SOURCE`).
     */
    static indentOf(line: string): string {
        return INDENT_RE.exec(line)![0];
    }

    /** The line with its indentation taken off: what it reads wherever it stands. */
    static dedent(line: string): string {
        return line.slice(this.indentOf(line).length);
    }

    /*
     * Two lines are compared as one of these two relations and no other, and
     * which question asks which is written here, once:
     *
     * - `VERBATIM`: the ladder's step 2; a plan's row, its subtree and
     *   generation blocks (`RowBasis.readsAsPlanned`); the text a timer
     *   finds its task by (`TimerTaskResolver`); a write's check that a line
     *   still reads what it read — the editor's line, a coordinate carried
     *   across the write's own edits, a line a carry moved (`FileLines`)
     * - `UP_TO_INDENT`: the weaker check `ON_RECORD`
     *   (`TaskScanner.onRecord`); a match checked against our last write
     *   (`TaskScanner.againstLastWrite`)
     *
     * A comparison of lines not in the table picks one of the two and joins
     * it; one that needs a third relation is a question for the outline, not
     * for its caller.
     */

    /** The same line, character for character, indentation included. */
    static readonly VERBATIM: LineRelation = relation(line => line);

    /**
     * The same line but for its indentation: what it reads wherever it stands
     * in the tree ({@link dedent}). A row moved under another is this to what
     * it was.
     */
    static readonly UP_TO_INDENT: LineRelation = relation(line => Outline.dedent(line));

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
