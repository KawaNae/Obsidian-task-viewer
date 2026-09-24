import { CodeFenceTracker, type FenceDelimiter } from '../../../utils/CodeFenceTracker';
import { LIST_BULLET_SOURCE, SPACE_OR_TAB_SOURCE } from './ListMarker';

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
const BLANK_RE = /^[ 	 　]*$/;

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
     * The columns `line`'s characters from `start` to `end` take where they
     * stand: a tab reaches the next multiple of four from its own column, so
     * the same tab is narrower or wider at another indentation.
     */
    static widthWithin(line: string, start: number, end: number): number {
        return widthFrom(line.slice(start, end), widthFrom(line.slice(0, start), 0));
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
     * A blank line: nothing on it but spaces, tabs, no-break spaces and
     * full-width spaces. Obsidian reads a line of the last two as blank too,
     * though it does not indent with them (`stages\l2-blocks\measurement.md`).
     */
    static isBlank(line: string): boolean {
        return BLANK_RE.test(line);
    }

    /**
     * The indentation a new child of the item on `parent` takes: `sample`
     * (the indentation of a child it already has) when that lands from its
     * content column to three columns past it, where a line opens a child;
     * otherwise the parent's own indentation and `unit`, repeated until it
     * reaches the content column. Short of it, a line is no child (under
     * `100. [ ] a`, one tab is a sibling). A unit is at most four columns, so
     * the child lands fewer than four past the content column, not in
     * indented code.
     *
     * Asked of the parent's line as written, not of a reading, so a line not
     * yet written — the next instance of a series, a generated parent — has
     * its children indented by the same rule as a row of the note. A sample
     * from another line (the row that fired, for its next instance) is used
     * only where it fits; a tab sample under a space-indented parent that
     * lands where a child opens is used as it is.
     */
    static childIndent(parent: string, sample: string | null, unit: string): string {
        const content = contentColumnOf(parent);
        if (sample !== null) {
            const col = this.depthOf(sample);
            if (col >= content && col <= content + 3) return sample;
        }
        let indent = this.indentOf(parent) + unit;
        while (this.depthOf(indent) < content) indent += unit;
        return indent;
    }

    /**
     * `line`, standing under a parent indented `from`, written under one
     * indented `to` with the columns between it and its parent kept: what a
     * line a move carries is written as. The parent's indentation taken off
     * as characters, when that leaves the line as many columns past the new
     * parent as it was past the old; else the new parent's indentation and a
     * space per column. A tab counts to the next multiple of four from where
     * it stands, so taking a parent's characters off a line that mixes tabs
     * and spaces can move it by other than the parent's columns — under a
     * tab, eight spaces less one are seven, a paragraph line past the moved
     * task's content (G3). A line shallower than its parent (a lazy one) is
     * written at the new parent's indentation. A blank line is left as it is,
     * and so is a line carried to where it stands (`from` and `to` the same).
     */
    static shiftIndent(line: string, from: string, to: string): string {
        if (this.isBlank(line)) return line;
        return this.shiftedIndent(this.indentOf(line), from, to) + this.dedent(line);
    }

    /** The indentation `indent` becomes, carried from under `from` to under `to` ({@link shiftIndent}). */
    static shiftedIndent(indent: string, from: string, to: string): string {
        if (from === to) return indent;
        const past = this.depthOf(indent) - this.depthOf(from);
        if (indent.startsWith(from)) {
            const shifted = to + indent.slice(from.length);
            if (this.depthOf(shifted) - this.depthOf(to) === past) return shifted;
        }
        return to + ' '.repeat(Math.max(past, 0));
    }

    /**
     * The note's list items and code blocks, read once from top to bottom.
     * Every question of where an item, a subtree or a fence begins and ends
     * is answered from here (`OutlineReading`).
     */
    static read(lines: readonly string[]): OutlineReading {
        return readOutline(lines, this.bodyStart(lines));
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

/** What a line is to a write (`OutlineReading.kindOf`). */
export type LineKind = 'frontmatter' | 'blank' | 'fence' | 'item-fence' | 'code' | 'item' | 'text';

/** A list item as the outline reads it. */
export interface OutlineItem {
    /** The line its marker stands on. */
    line: number;
    /** The column its content starts at: a line indented this far or more goes on in it. */
    contentColumn: number;
    /** The line of the item it stands in, or null at the top. */
    parent: number | null;
    /** The index just past its last line that is not blank. */
    end: number;
}

/** A fenced code block as the outline reads it. */
export interface OutlineFence {
    /** The line of its opening delimiter. */
    line: number;
    /** The line of its closing delimiter; null when it ends without one. */
    close: number | null;
    /** The index just past its last line, a blank one included: the lines `inCode` reads as its. */
    end: number;
    /** The info string after the opening delimiter, trimmed. */
    info: string;
    /** The column the opening delimiter stands at. */
    column: number;
    /** The index in its line of the opening delimiter's first character. */
    from: number;
}

/**
 * A note read as list items and code blocks: `Outline.read`'s answer.
 *
 * Every line has at most one item it stands in (the innermost), and is code
 * or is not. A subtree is an item's lines, a task's parent the item around
 * it, a line fenced when a code block holds it — asked of this, never walked
 * again by whoever asks.
 */
export class OutlineReading {
    constructor(
        readonly lines: readonly string[],
        private readonly items: ReadonlyMap<number, OutlineItem>,
        private readonly owners: readonly (number | null)[],
        private readonly codes: readonly boolean[],
        readonly fences: readonly OutlineFence[],
        /** The index of the body's first line (`Outline.bodyStart`). */
        readonly bodyStart: number,
    ) {}

    /**
     * What `line` is, as a write is held to it: in the frontmatter, blank,
     * in a fenced code block (its delimiters included; `item-fence` when the
     * line opens an item as well, `- ```js`), indented code, opening a list
     * item, or text — a paragraph, a heading, a thematic break.
     *
     * Blank wherever it stands, a fence included: a blank line shows nothing,
     * so which block holds one changes nothing the note shows, and nothing
     * the plugin reads.
     */
    kindOf(line: number): LineKind {
        if (line < this.bodyStart) return 'frontmatter';
        if (Outline.isBlank(this.lines[line])) return 'blank';
        if (this.fenced()[line]) return this.items.has(line) ? 'item-fence' : 'fence';
        if (this.codes[line]) return 'code';
        return this.items.has(line) ? 'item' : 'text';
    }

    private fencedLines: boolean[] | null = null;

    /** Per line, whether a fence holds it. */
    private fenced(): boolean[] {
        if (this.fencedLines === null) {
            const fenced = new Array<boolean>(this.lines.length).fill(false);
            for (const fence of this.fences) fenced.fill(true, fence.line, fence.end);
            this.fencedLines = fenced;
        }
        return this.fencedLines;
    }

    /**
     * The item whose marker is on `line`, or null. A line that opens one is
     * code only when a fence opens on it too (`- ```js`); no task, `==>` or
     * property line does, so a reader of those asks nothing more of code.
     */
    item(line: number): OutlineItem | null {
        return this.items.get(line) ?? null;
    }

    /** The innermost item `line` stands in (itself when it opens one), or null. */
    ownerOf(line: number): number | null {
        return this.owners[line] ?? null;
    }

    /** Whether `line` is code: inside a code block, its delimiters included. */
    inCode(line: number): boolean {
        return this.codes[line] ?? false;
    }

    /** Per-line {@link inCode}. */
    codeMask(): boolean[] {
        return [...this.codes];
    }

    /**
     * The index just past `row`'s subtree: the end of the item `row` opens,
     * the blank lines at its very end left out. A blank line inside does
     * not end it (a deeper line below a blank one is still the row's), and
     * a code block inside ends with the item. A line that opens no item has
     * no subtree.
     */
    subtreeEnd(row: number): number {
        return this.items.get(row)?.end ?? row + 1;
    }

    /** The items `row`'s item stands in, innermost first. */
    itemsAbove(row: number): number[] {
        const above: number[] = [];
        for (let parent = this.items.get(row)?.parent ?? null; parent !== null; parent = this.items.get(parent)?.parent ?? null) {
            above.push(parent);
        }
        return above;
    }
}

/**
 * The column the content of the item `line` opens starts at, read from the
 * line alone; for a line that opens none, the column its text starts at.
 */
function contentColumnOf(line: string): number {
    const col = Outline.depthOf(line);
    return itemStart(Outline.dedent(line), col)?.contentColumn ?? col;
}

/** Column width of `text` read from column `from`, a tab reaching the next multiple of four. */
function widthFrom(text: string, from: number): number {
    let col = from;
    for (const ch of text) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
    return col - from;
}

const MARKER_RE = new RegExp(`^${LIST_BULLET_SOURCE}`);
const GAP_RE = /^[ \t]*/;
const HEADING_RE = /^#{1,6}(?:[ \t]|$)/;
const THEMATIC_BREAK_RE = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * The item a line opens when its indentation leaves it `text` at column
 * `col`: the column its content starts at, and what follows the marker.
 * CommonMark: a marker, then a space or a tab or the end of the line; up to
 * four columns of gap put the content after the gap, five or more put it one
 * column after the marker (the rest is indented code).
 */
function itemStart(text: string, col: number): { contentColumn: number; rest: string } | null {
    if (THEMATIC_BREAK_RE.test(text)) return null;
    const marker = MARKER_RE.exec(text);
    if (!marker) return null;
    const after = text.slice(marker[0].length);
    const gap = GAP_RE.exec(after)![0];
    if (gap === '' && after !== '') return null;
    const markerEnd = col + marker[0].length;
    const rest = after.slice(gap.length);
    const gapWidth = widthFrom(gap, markerEnd);
    const contentColumn = rest === '' || gapWidth > 4 ? markerEnd + 1 : markerEnd + gapWidth;
    return { contentColumn, rest };
}

/**
 * The one reading of a note's blocks. The rules are CommonMark's container
 * rules for list items, with the blocks the plugin reads (fences, headings,
 * thematic breaks, paragraphs) and nothing else:
 *
 * - an item goes on over every line indented to its content column, and over
 *   blank lines; a line that goes on a paragraph (a lazy continuation) goes
 *   on the item too, however shallow
 * - a fence opens up to three columns past the content column of the item it
 *   stands in, and goes on over the lines indented that far. A shallower
 *   line goes on the fence too, and the item with it, the way a lazy line
 *   goes on a paragraph; what ends both is a line that starts a block of its
 *   own (an item, a fence, a heading, a thematic break) or a shallower line
 *   after a blank one. A fence with no closing line ends there too
 * - four columns or more past the content column is a paragraph going on, or
 *   indented code
 * - a line of nothing but spaces, tabs, no-break spaces and full-width
 *   spaces is blank
 *
 * The fence going on over shallower lines and the blank lines of NBSP and
 * U+3000 are where Obsidian 1.12.4 parts from CommonMark: its `listItems`
 * and its reading view agree on both, in every shape measured
 * (`stages\l2-blocks\measurement.md`), and the outline reads what the note
 * shows. The rules live here and nowhere else.
 */
function readOutline(lines: readonly string[], start: number): OutlineReading {
    const items = new Map<number, OutlineItem>();
    const owners: (number | null)[] = new Array(lines.length).fill(null);
    const codes: boolean[] = new Array(lines.length).fill(false);
    const fences: OutlineFence[] = [];

    type Frame = { item: OutlineItem; last: number };
    const stack: Frame[] = [];
    // What the innermost open block is: a paragraph a lazy line may go on,
    // indented code a deeper line after a blank one goes on, or neither.
    let leaf: 'paragraph' | 'indented' | 'none' = 'none';
    type OpenFence = { open: FenceDelimiter; depth: number; block: OutlineFence };
    let fence = null as OpenFence | null;
    let afterBlank = false;

    const innermost = () => (stack.length > 0 ? stack[stack.length - 1].item.line : null);
    const holds = (i: number) => {
        owners[i] = innermost();
        for (const frame of stack) frame.last = i;
    };
    const closeTo = (depth: number) => {
        while (stack.length > depth) {
            const frame = stack.pop()!;
            frame.item.end = frame.last + 1;
        }
        if (fence && fence.depth > depth) fence = null;
    };
    // Whether a line at column `col` reading `text` starts a block of its own
    // in the item `matched` deep: a fence, a heading, a thematic break or an
    // item, up to three columns past that item's content column. Such a line
    // is never a lazy one.
    const startsBlock = (col: number, text: string, matched: number) => {
        const base = matched > 0 ? stack[matched - 1].item.contentColumn : 0;
        return col - base <= 3 && (
            CodeFenceTracker.opening(text) !== null
            || HEADING_RE.test(text)
            || THEMATIC_BREAK_RE.test(text)
            || itemStart(text, col) !== null);
    };
    const openFence = (i: number, open: FenceDelimiter, column: number, rest: string) => {
        const block: OutlineFence = { line: i, close: null, end: i + 1, info: open.info, column, from: lines[i].length - rest.length };
        fences.push(block);
        fence = { open, depth: stack.length, block };
        codes[i] = true;
        leaf = 'none';
    };

    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        if (Outline.isBlank(line)) {
            owners[i] = innermost();
            // A blank line in an open fence is the fence's, whatever comes
            // after it: code, and in the fence's range (q13).
            if (fence) {
                codes[i] = true;
                fence.block.end = i + 1;
            }
            if (leaf === 'paragraph') leaf = 'none';
            afterBlank = true;
            continue;
        }
        const lazyAllowed = !afterBlank;
        afterBlank = false;

        const col = Outline.depthOf(line);
        const text = Outline.dedent(line);
        let matched = 0;
        while (matched < stack.length && col >= stack[matched].item.contentColumn) matched++;

        if (fence) {
            if (matched >= fence.depth) {
                const base = fence.depth > 0 ? stack[fence.depth - 1].item.contentColumn : 0;
                codes[i] = true;
                holds(i);
                fence.block.end = i + 1;
                if (col - base <= 3 && CodeFenceTracker.closes(text, fence.open)) {
                    fence.block.close = i;
                    fence = null;
                }
                continue;
            }
            // A shallower line goes on the fence as a lazy line goes on a
            // paragraph, and the item with it — unless it starts a block of
            // its own, or a blank line stands before it.
            if (lazyAllowed && !startsBlock(col, text, matched)) {
                codes[i] = true;
                holds(i);
                fence.block.end = i + 1;
                continue;
            }
            // The item the fence stands in ends here, and the fence with it.
            fence = null;
        }

        const base = matched > 0 ? stack[matched - 1].item.contentColumn : 0;
        const shallow = col - base <= 3;
        if (matched < stack.length && leaf === 'paragraph' && !startsBlock(col, text, matched)) {
            holds(i);
            continue;
        }
        closeTo(matched);

        if (!shallow) {
            if (leaf !== 'paragraph') {
                codes[i] = true;
                leaf = 'indented';
            }
            holds(i);
            continue;
        }

        const open = CodeFenceTracker.opening(text);
        if (open) {
            holds(i);
            openFence(i, open, col, text);
            continue;
        }

        const started = itemStart(text, col);
        if (started) {
            const item: OutlineItem = { line: i, contentColumn: started.contentColumn, parent: innermost(), end: i + 1 };
            holds(i);
            items.set(i, item);
            stack.push({ item, last: i });
            owners[i] = i;
            const inner = started.rest === '' ? null : CodeFenceTracker.opening(started.rest);
            if (inner) openFence(i, inner, started.contentColumn, started.rest);
            else leaf = started.rest === '' ? 'none' : 'paragraph';
            continue;
        }

        holds(i);
        leaf = HEADING_RE.test(text) || THEMATIC_BREAK_RE.test(text) ? 'none' : 'paragraph';
    }
    closeTo(0);

    return new OutlineReading(lines, items, owners, codes, fences, start);
}
