import { Outline, type OutlineReading } from '../../parsing/utils/Outline';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';

/**
 * Where a write may put a line: the answer to "where does this go", as
 * opposed to "which line is this" (`WriteSession.locate`).
 *
 * Every answer is an index to splice at, and every answer is one the body can
 * hold: below the frontmatter and outside every code fence. A line put above
 * the frontmatter or inside a fence is not a task to the index — the next
 * instance of a series written there is a series cut off without a word, and
 * the command that fired is consumed all the same. So where the rule for a
 * question lands outside the body, the answer is `null`, and the write does
 * not happen: a write refused is one the user hears about and can make again.
 *
 * The frontmatter, the list items and the fences are read the way the parser
 * reads them (`Outline.read`), so "inside the body" means what the index will
 * read as the body, and a row's group is the item it stands in.
 */
export class Placement {
    /**
     * Where the next instance of `row` goes: the head of the group of
     * siblings it stands in.
     *
     * A row inside another item has its group under that item, and the head
     * is the line just below the item's own. A row at the top has its group
     * in the run of tasks just above it: each one a task item at the top
     * whose subtree ends where the run below it begins. Anything else ends
     * the run — a paragraph, a table, a `---` rule, a heading, a fence, the
     * frontmatter's closing line, a blank line between two siblings. None of
     * those is a task, and the next instance joins the tasks it stands among,
     * not the text above them.
     */
    static groupHead(lines: readonly string[], row: number): number | null {
        const outline = Outline.read(lines);
        const parent = outline.item(row)?.parent ?? null;
        if (parent !== null) return this.inBodyOf(outline, parent + 1);

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
        return this.inBodyOf(outline, head);
    }

    /** Where a line just past `row`'s subtree goes: `row` gains a next sibling there. */
    static afterSubtree(lines: readonly string[], row: number): number | null {
        const outline = Outline.read(lines);
        return this.inBodyOf(outline, outline.subtreeEnd(row));
    }

    /** Where a first child of `row` goes: just below it. */
    static firstChild(lines: readonly string[], row: number): number | null {
        return this.inBody(lines, row + 1);
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
    static afterCompletedRun(lines: readonly string[], row: number): number | null {
        const outline = Outline.read(lines);
        const parent = outline.item(row)?.parent ?? null;
        let end = outline.subtreeEnd(row);
        for (let next = outline.item(end); next !== null && next.parent === parent; next = outline.item(end)) {
            if (TaskLineClassifier.classify(lines[end])?.statusChar !== 'x') break;
            end = next.end;
        }
        return this.inBodyOf(outline, end);
    }

    /**
     * Where lines appended to the note go: after its last line, and before
     * the empty element a note that ends with a terminator splits into, so
     * the terminator stays the note's last character. Null when the note
     * ends inside a fence that never closes: appended there, the lines are
     * no tasks to the index.
     */
    static end(lines: readonly string[]): number | null {
        const at = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
        return this.inBody(lines, at);
    }

    /**
     * `at`, when a line spliced in there is read as part of the body; null
     * otherwise. A line goes in above the frontmatter's end, or inside a
     * fence — past its opening line and before its end — and is not.
     */
    static inBody(lines: readonly string[], at: number): number | null {
        return this.inBodyOf(Outline.read(lines), at);
    }

    /**
     * {@link inBody} on a reading of the lines. A fence that never closes at
     * the top of the note holds every line after its opening one, a line put
     * at the very end included. One that never closes in a list item ends
     * with the item (`Outline.read`); a line put just past it stands after
     * it, as a sibling put there does (R5). A line indented as the fence's
     * own content and put there would go on the fence — the reading before
     * the write cannot tell, and the writes that splice there put siblings.
     */
    private static inBodyOf(outline: OutlineReading, at: number): number | null {
        if (at < Outline.bodyStart(outline.lines) || at > outline.lines.length) return null;
        for (const fence of outline.fences) {
            if (at <= fence.line) continue;
            if (at < fence.end) return null;
            if (fence.close === null && outline.ownerOf(fence.line) === null) return null;
        }
        return at;
    }
}
