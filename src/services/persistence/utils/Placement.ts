import { CodeFenceTracker } from '../../../utils/CodeFenceTracker';
import { Outline } from '../../parsing/utils/Outline';
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
 * The frontmatter and the fences are read the way the parser reads them
 * (`Outline.bodyStart`, `CodeFenceTracker.scan`), so "inside the body" means
 * what the index will read as the body.
 */
export class Placement {
    /**
     * Where the next instance of `row` goes: the head of the group of
     * siblings it stands in.
     *
     * A row that is indented has its group under the line it is indented
     * beneath, and the head is the line just below that one. A row that is
     * not has its group in the run of tasks just above it: each one a task
     * line outside any fence, at the row's depth, whose subtree ends where the
     * run below it begins. Anything else ends the run — a paragraph, a table,
     * a `---` rule, a heading, a fence, the frontmatter's closing line, a
     * blank line between two siblings. None of those is a task, and the next
     * instance joins the tasks it stands among, not the text above them.
     */
    static groupHead(lines: readonly string[], row: number): number | null {
        const bodyStart = Outline.bodyStart(lines);
        const depth = Outline.depthOf(lines[row]);

        if (depth > 0) {
            // The first line above that is shallower, over any blank line:
            // a blank line inside the parent's children does not make the
            // top of the note their parent.
            for (let i = row - 1; i >= bodyStart; i--) {
                const line = lines[i];
                if (line.trim() === '') continue;
                if (Outline.depthOf(line) < depth) return this.inBody(lines, i + 1);
            }
            return this.inBody(lines, bodyStart);
        }

        const fenced = CodeFenceTracker.mask([...lines]);
        let head = row;
        for (; ;) {
            let above = head - 1;
            while (above >= bodyStart
                && (lines[above].trim() === '' || Outline.depthOf(lines[above]) > depth)) {
                above--;
            }
            if (above < bodyStart) break;
            const line = lines[above];
            if (Outline.depthOf(line) !== depth) break;
            if (fenced[above] || !TaskLineClassifier.isTaskLine(line)) break;
            if (Outline.subtreeEnd(lines, above) !== head) break;
            head = above;
        }
        return this.inBody(lines, head);
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
     * fence — past its opening line and not past its closing one, or past
     * the end of a fence that never closes — and is not.
     */
    static inBody(lines: readonly string[], at: number): number | null {
        if (at < Outline.bodyStart(lines) || at > lines.length) return null;
        for (const fence of CodeFenceTracker.scan([...lines]).opens) {
            if (at > fence.line && at <= (fence.close ?? lines.length)) return null;
        }
        return at;
    }
}
