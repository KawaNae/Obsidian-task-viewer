import { Outline, type OutlineReading, type PlacedReading } from '../../parsing/utils/Outline';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import { FileOperations } from './FileOperations';

/**
 * Where a write puts lines: the index to put them at, the item they go under
 * (null at the top), and the indentation their first line takes there.
 *
 * Position and indentation together are what a line means where it stands,
 * and the item it goes under is what the write's check holds its first line
 * to (`Outline.check`): a spot says where the line is meant to be, not only
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
 * subtree is the item's lines. Whether the lines put there read as meant — a
 * task, not code; under the item meant, not taking in the lines below — is
 * not answered here but by the reading of the lines as written
 * (`Outline.check`, in `processLines`). A line put past a fence in a list item
 * that never closes goes on the fence when it is indented as the fence's
 * content, and a line put at the end of a note whose last fence never closes
 * goes in it; the check reads both, and the write is refused.
 */
export class Placement {
    /**
     * Where the next instance of `row` goes: the head of the group of
     * siblings it stands in.
     *
     * A row inside another item has its group under that item, and the head
     * is the first line past the item's own text that goes on
     * (`OutlineReading.leadEnd`). A row at the top has its group in the run of
     * tasks just above it: each one a task item at the top whose subtree
     * ends where the run below it begins. Anything else ends the run — a
     * paragraph, a table, a `---` rule, a heading, a fence, the frontmatter's
     * closing line, a blank line between two siblings. None of those is a
     * task, and the next instance joins the tasks it stands among, not the
     * text above them.
     */
    static groupHead(lines: readonly string[], row: number): Spot {
        const outline = Outline.read(lines);
        const parent = outline.item(row)?.parent ?? null;
        const indent = Outline.indentOf(lines[row]);
        if (parent !== null) return { at: outline.leadEnd(parent + 1, parent), parent, indent };

        const bodyStart = Outline.bodyStart(lines);
        let head = row;
        while (head - 1 >= bodyStart) {
            // The top-level item the line just above stands in.
            let above = outline.ownerOf(head - 1);
            while (above !== null && outline.item(above)!.parent !== null) above = outline.item(above)!.parent;
            if (above === null || outline.subtreeEnd(above) !== head) break;
            if (!TaskLineClassifier.isTaskLine(lines[above])) break;
            head = above;
        }
        return { at: head, parent: null, indent };
    }

    /** Just past `row`'s subtree, as its next sibling. */
    static afterSubtree(lines: readonly string[], row: number): Spot {
        const outline = Outline.read(lines);
        return this.sibling(outline, row, outline.subtreeEnd(row));
    }

    /** Just above `row`, as its sibling. */
    static before(lines: readonly string[], row: number): Spot {
        return this.sibling(Outline.read(lines), row, row);
    }

    /**
     * Where a first child of `row` goes: just below it, past its own text
     * that goes on (`OutlineReading.leadEnd`), which a child put above would
     * take in as its own.
     */
    static firstChild(lines: readonly string[], row: number): Spot {
        const outline = Outline.read(lines);
        return { at: outline.leadEnd(row + 1, row), parent: row, indent: FileOperations.resolveChildIndent(lines, row) };
    }

    /** Where a last child of `row` goes: just past its subtree. */
    static lastChild(lines: readonly string[], row: number): Spot {
        const outline = Outline.read(lines);
        return { at: outline.subtreeEnd(row), parent: row, indent: FileOperations.resolveChildIndent(lines, row) };
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
    static afterCompletedRun(lines: readonly string[], row: number): Spot {
        const outline = Outline.read(lines);
        const parent = outline.item(row)?.parent ?? null;
        let end = outline.subtreeEnd(row);
        for (let next = outline.item(end); next !== null && next.parent === parent; next = outline.item(end)) {
            if (TaskLineClassifier.classify(lines[end])?.statusChar !== 'x') break;
            end = next.end;
        }
        return this.sibling(outline, row, end);
    }

    /**
     * Where lines appended to the note go: after its last line, and before
     * the empty element a note that ends with a terminator splits into, so
     * the terminator stays the note's last character.
     */
    static end(lines: readonly string[]): Spot {
        const at = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
        return { at, parent: null, indent: '' };
    }

    /**
     * Where a line under the heading on `heading` goes: just below it, past
     * the paragraph below it (`OutlineReading.leadEnd`), at the top. At the
     * indentation of the first item at the top below that, blank lines
     * aside, as its sibling; unindented when none follows. A task indented
     * under the heading stays where it stands, not under the new line.
     */
    static underHeading(lines: readonly string[], heading: number): Spot {
        const outline = Outline.read(lines);
        const at = outline.leadEnd(heading + 1, null);
        let next = at;
        while (next < lines.length && Outline.isBlank(lines[next])) next++;
        const indent = next < lines.length && outline.item(next)?.parent === null ? Outline.indentOf(lines[next]) : '';
        return { at, parent: null, indent };
    }

    private static sibling(outline: OutlineReading, row: number, at: number): Spot {
        return { at, parent: outline.item(row)?.parent ?? null, indent: Outline.indentOf(outline.lines[row]) };
    }
}

/** The lines a write puts in, each with how it is to read once written (`Outline.check`). */
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
