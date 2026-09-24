import { Outline, type OutlineReading } from '../../parsing/utils/Outline';
import type { PlacedReading } from '../../parsing/utils/OutlineCheck';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import { FileOperations } from './FileOperations';

/**
 * Where a write puts lines: the index to put them at, the item they go under
 * (null at the top), and the indentation their first line takes there.
 *
 * Position and indentation together are what a line means where it stands,
 * and the item it goes under is what the write's check holds its first line
 * to (`checkWrite`): a spot says where the line is meant to be, not only
 * where it is spliced.
 */
export interface Spot {
    at: number;
    parent: number | null;
    indent: string;
}

/** A line a write puts in: its text, how it is to read, and the line it is when it is one carried. */
export interface PlacedLine extends PlacedReading {
    text: string;
    /** The line, in the lines as they stand when it is put, that this one is, carried (`LineDraft.put`). */
    from?: number;
}

/**
 * Where a write may put a line: the answer to "where does this go", as
 * opposed to "which line is this" (`WriteSession.row`). Every write that puts
 * a line in the body asks here (`LineDraft.put` takes a {@link Spot}).
 *
 * The answers are read off the lines before the write, the way the parser
 * reads them (`Outline.read`): a row's group is the item it stands in, and a
 * subtree is the item's lines. Each question is asked with `head`, the first
 * line the write puts (its indentation aside: it takes the spot's), and each
 * answer goes past the lines that line would take in, as the reading with the
 * line in it says ({@link settle}).
 *
 * Whether the lines put there read as meant — a task, not code; under the
 * item meant, not taking in the lines below — is not answered here but by the
 * reading of the lines as written (`checkWrite`, in `processLines`). A line put
 * past a fence in a list item that never closes goes on the fence when it is
 * indented as the fence's content, and a line put at the end of a note whose
 * last fence never closes goes in it; the check reads both, and the write is
 * refused.
 */
export class Placement {
    /**
     * Where the next instance of `row` goes: the head of the group of
     * siblings it stands in.
     *
     * A row inside another item has its group under that item, and the head
     * is the first line past the item's own text that goes on. A row at the
     * top has its group in the run of tasks just above it: each one a task
     * item at the top whose subtree ends where the run below it begins.
     * Anything else ends the run — a paragraph, a table, a `---` rule, a
     * heading, a fence, the frontmatter's closing line, a blank line between
     * two siblings. None of those is a task, and the next instance joins the
     * tasks it stands among, not the text above them.
     */
    static groupHead(lines: readonly string[], row: number, head: string): Spot {
        const outline = Outline.read(lines);
        const parent = outline.item(row)?.parent ?? null;
        if (parent !== null) return this.sibling(outline, parent + 1, parent, head);

        let first = row;
        while (first - 1 >= outline.bodyStart) {
            // The top-level item the line just above stands in.
            let above = outline.ownerOf(first - 1);
            while (above !== null && outline.item(above)!.parent !== null) above = outline.item(above)!.parent;
            if (above === null || outline.subtreeEnd(above) !== first) break;
            if (!TaskLineClassifier.isTaskLine(lines[above])) break;
            first = above;
        }
        return this.sibling(outline, first, null, head);
    }

    /** Just past `row`'s subtree, as its next sibling. */
    static afterSubtree(lines: readonly string[], row: number, head: string): Spot {
        const outline = Outline.read(lines);
        return this.sibling(outline, outline.subtreeEnd(row), outline.item(row)?.parent ?? null, head);
    }

    /** Just above `row`, as its sibling. */
    static before(lines: readonly string[], row: number, head: string): Spot {
        const outline = Outline.read(lines);
        return this.sibling(outline, row, outline.item(row)?.parent ?? null, head);
    }

    /** Where a first child of `row` goes: just below it, past its own text that goes on. */
    static firstChild(lines: readonly string[], row: number, head: string): Spot {
        return this.sibling(Outline.read(lines), row + 1, row, head);
    }

    /** Where a last child of `row` goes: just past its subtree. */
    static lastChild(lines: readonly string[], row: number, head: string): Spot {
        const outline = Outline.read(lines);
        return this.sibling(outline, outline.subtreeEnd(row), row, head);
    }

    /**
     * Where a line goes past the completed siblings that directly follow
     * `row`, so a new record joins the end of a chronological run instead of
     * splitting it: just past the subtree of the last of them (of `row`'s own
     * when the next sibling is not completed).
     *
     * "Completed" is `[x]` and nothing else — the status character is a fact
     * the parser knows, unlike the shape of a line, which cannot be told apart
     * from something the user typed by hand. The run stops at the first line
     * past a subtree that is not a completed sibling: a blank line, a line
     * that is no item in `row`'s parent, or an unfinished one.
     */
    static afterCompletedRun(lines: readonly string[], row: number, head: string): Spot {
        const outline = Outline.read(lines);
        const parent = outline.item(row)?.parent ?? null;
        let last = row;
        for (let next = outline.item(outline.subtreeEnd(last)); next !== null && next.parent === parent; next = outline.item(outline.subtreeEnd(last))) {
            if (TaskLineClassifier.classify(lines[next.line])?.statusChar !== 'x') break;
            last = next.line;
        }
        return this.sibling(outline, outline.subtreeEnd(last), parent, head);
    }

    /**
     * Where lines appended to the note go: after its last line, and before
     * the empty element a note that ends with a terminator splits into, so
     * the terminator stays the note's last character. Nothing stands after
     * it for a line put there to take in.
     */
    static end(lines: readonly string[]): Spot {
        const at = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
        return { at, parent: null, indent: '' };
    }

    /**
     * Where a line under the heading on `heading` goes: just below it, past
     * the paragraph and the code below it, at the top as a sibling of the
     * items there. A task indented under the heading stays where it stands,
     * not under the new line.
     */
    static underHeading(lines: readonly string[], heading: number, head: string): Spot {
        return this.sibling(Outline.read(lines), heading + 1, null, head);
    }

    /**
     * At `at` or past what a line there takes in, a line under `parent`, at
     * a sibling's indentation: a child is a sibling of the children there.
     */
    private static sibling(outline: OutlineReading, at: number, parent: number | null, head: string): Spot {
        return this.settle(outline, at, parent, head, spot => this.siblingIndent(outline, parent, spot));
    }

    /**
     * The indentation a sibling under `parent` takes at `at`: that of the
     * item it goes above (the first line from `at` that is not blank) when
     * that is a sibling; else that of the sibling it goes below, the one
     * whose subtree ends at `at`; else a child's of `parent`, nothing at the
     * top. Siblings may be spelled apart (a tab and four spaces, two spaces
     * and four); whichever it goes next to, it reads as one of them.
     */
    private static siblingIndent(outline: OutlineReading, parent: number | null, at: number): string {
        const lines = outline.lines;
        let next = at;
        while (next < lines.length && Outline.isBlank(lines[next])) next++;
        if (next < lines.length && outline.item(next) !== null && outline.item(next)!.parent === parent) {
            return Outline.indentOf(lines[next]);
        }
        for (let up = at > 0 ? outline.ownerOf(at - 1) : null; up !== null && up !== parent; up = outline.item(up)!.parent) {
            if (outline.item(up)!.parent !== parent) continue;
            if (outline.subtreeEnd(up) === at) return Outline.indentOf(lines[up]);
            break;
        }
        return parent === null ? '' : FileOperations.resolveChildIndent(lines, parent);
    }

    /**
     * `at`, or past the lines from `at` that `head` put there would take in:
     * asked of the reading with the line in it (`Outline.read`), not
     * foretold. A line put above a task's text that goes on, a paragraph
     * under a heading, or a fence it opens the content of takes them in as
     * its own; below them, it takes in nothing. It goes past what it takes
     * in up to the first item of the note among it — an item it would make
     * its child stays where it stands, and the write's check refuses the
     * line put above it. `indentAt` answers the indentation the line takes
     * at each place it is tried. Only `head` is tried: a line of the block
     * below it that takes in more is refused by the write's check.
     */
    private static settle(
        outline: OutlineReading,
        at: number,
        parent: number | null,
        head: string,
        indentAt: (at: number) => string,
    ): Spot {
        const lines = outline.lines;
        const body = Outline.dedent(head);
        for (;;) {
            const indent = indentAt(at);
            const tried = Outline.read([...lines.slice(0, at), indent + body, ...lines.slice(at)]);
            // Line `k` of the lines tried is line `k - 1` of the note.
            const end = tried.item(at)?.end ?? at + 1;
            let past = at;
            for (let k = at + 1; k < end && outline.item(k - 1) === null; k++) past = k;
            if (past === at) return { at, parent, indent };
            at = past;
        }
    }
}

/** The lines a write puts in, each with how it is to read once written (`checkWrite`). */
export const Block = {
    /**
     * Lines as they read by themselves: each of the kind it is in their own
     * reading, an item at the top under the spot's parent and one inside
     * under the line it stands in there. A task appended to a note, a line
     * the editor's menu duplicates, a heading and the task under it.
     */
    read(texts: readonly string[]): PlacedLine[] {
        const reading = Outline.read(texts);
        return texts.map((text, i) => {
            const item = reading.item(i);
            return { text, kind: reading.kindOf(i), under: item === null ? undefined : item.parent ?? 'spot' };
        });
    },

    /**
     * `block` written at `indent`: its first line there, every other as far
     * past it as it stands past the first (`Outline.shiftIndent`). What a
     * put writes at its spot (`LineDraft.put`), and a note made of a block
     * writes at the top.
     */
    at(block: readonly PlacedLine[], indent: string): PlacedLine[] {
        const frame = block.length > 0 ? Outline.indentOf(block[0].text) : '';
        return block.map(line => ({ ...line, text: Outline.shiftIndent(line.text, frame, indent) }));
    },

    /** One line, read by itself as {@link read} reads, its indentation aside: it goes at the spot's indentation. */
    line(text: string): PlacedLine[] {
        return [{ ...Block.read([Outline.dedent(text)])[0], text }];
    },

    /**
     * The lines on `rows` of `reading` written as `texts` (one each), to read
     * as they do there: each of the kind it is, an item under the line it
     * stands in there. The first stands under the spot's parent; an item whose
     * line is not among `rows` has lost it. With `carried`, each is the line
     * it is written from, moved (`LineDraft.put`).
     */
    of(reading: OutlineReading, rows: readonly number[], texts: readonly string[], carried = false): PlacedLine[] {
        return rows.map((row, i) => {
            const item = reading.item(row);
            const parent = item?.parent ?? null;
            const under = item === null ? undefined
                : i === 0 ? 'spot'
                    : parent !== null && rows.includes(parent) ? rows.indexOf(parent) : 'lost';
            return { text: texts[i], kind: reading.kindOf(row), under, ...(carried ? { from: row } : {}) };
        });
    },
};
