import type { Task, ScopeKeys } from '../../../types';
import { isTvInline } from '../../../types';
import type { SectionNode } from './Sections';
import { NoteSections } from './NoteSections';
import { BuiltinPropertyExtractor } from './BuiltinPropertyExtractor';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { TagExtractor } from '../utils/TagExtractor';
import type { ParserChain } from '../strategies/ParserChain';
import { readFlow } from '../utils/FlowLineScanner';
import { flowValidation } from '../../lang/flow/FlowSegments';
import { Outline, type OutlineReading } from '../utils/Outline';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';

export interface TaskExtractionContext {
    filePath: string;
    scopeKeys: ScopeKeys;
    /** The chain the note's task lines are read with (`lineParsers(settings)`). */
    parsers: ParserChain;
}

/**
 * The rows of a note, read off its one reading (`Outline.read`) and its
 * sections with their values resolved (`NoteSections.read`,
 * `SectionPropertyResolver.resolve`).
 */
export class NoteTasks {
    /**
     * Every line that opens a task (`TaskLineClassifier.opensTask`) is read
     * once, top to bottom, by the chain, and is a row: a bare `- [ ]` with no
     * date or command too, and one under another task too. The rows come in
     * the order the note writes them.
     *
     * Then, for each row:
     * - Its parent is the nearest item above it (`itemsAbove`) that is a row:
     *   a task among the items it stands in, whatever indentation (2 or 4
     *   spaces, a tab) and whatever notes stand between. Its children are
     *   the rows whose parent it is, in the note's order.
     * - Its flow is read once (`readFlow`), for a `tv-inline` row.
     * - Its child lines are the lines of its subtree, less its child rows'
     *   subtrees and its own flow lines: each line of the note is a child
     *   line of one row at most, and none is a row's and a line's. A line in
     *   code stays a child line (it goes with the row verbatim) and is never
     *   read as notation.
     * - Its properties are those of its own property lines
     *   (`ChildLineClassifier.ownPropertyLines`), the lines the writer edits.
     * - What its section gives it goes to `cascadeContext`, beside what the
     *   row says itself (`getEffective*` puts the two together).
     */
    static extract(outline: OutlineReading, sections: readonly SectionNode[], ctx: TaskExtractionContext): Task[] {
        const rows = new Map<number, Task>();
        for (let line = outline.bodyStart; line < outline.lines.length; line++) {
            if (!TaskLineClassifier.opensTask(outline, line)) continue;
            // The chain ends in tv-inline, which reads every task line: no
            // line that opens a task is refused.
            const task = ctx.parsers.parse(outline.lines[line], ctx.filePath, line);
            if (task) rows.set(line, task);
        }

        for (const [line, task] of rows) {
            const parentLine = outline.itemsAbove(line).find(above => rows.has(above));
            if (parentLine !== undefined) {
                const parent = rows.get(parentLine)!;
                task.parentId = parent.id;
                parent.childIds.push(task.id);
            }
            this.fill(task, outline, NoteSections.at(sections, line)!, rows, ctx.scopeKeys);
        }
        return [...rows.values()];
    }

    /** What the row reads of the lines under it and of its section. */
    private static fill(
        task: Task,
        outline: OutlineReading,
        section: SectionNode,
        rows: ReadonlyMap<number, Task>,
        keys: ScopeKeys,
    ): void {
        const { line } = task;
        task.indent = Outline.depthOf(outline.lines[line]);

        // The one validation slot, filled in order: the line's own verdict
        // (a date rule, then the date block's parse error) stands; only a
        // line with none takes its command's first diagnostic.
        const flow = isTvInline(task) ? readFlow(outline, line) : undefined;
        if (flow) {
            task.flow = flow;
            task.validation ??= flowValidation(flow);
        }

        task.childLines = this.childLines(outline, line, rows, flow?.childSegments.map(segment => segment.bodyLine) ?? []);

        const own = new Set(ChildLineClassifier.ownPropertyLines(outline, line));
        const extracted = BuiltinPropertyExtractor.extract(
            ChildLineClassifier.collectProperties(task.childLines.filter(child => own.has(child.bodyLine))),
            keys,
        );
        // Raw is the row's own say: its property lines and its content's tags.
        task.properties = extracted.properties;
        task.color = extracted.color;
        task.linestyle = extracted.linestyle;
        task.mask = extracted.mask;
        if (extracted.tags && extracted.tags.length > 0) task.tags = TagExtractor.merge(extracted.tags, task.tags);

        // What the section gives. Dates and style are the section's only
        // where the row says none (they override); tags and properties go
        // through in part (a union; child-wins per key), so they are kept
        // whole.
        const cc: NonNullable<Task['cascadeContext']> = {};
        if (!task.startDate && section.resolvedStartDate) cc.startDate = section.resolvedStartDate;
        if (!task.startTime && section.resolvedStartTime) cc.startTime = section.resolvedStartTime;
        if (!task.endDate && section.resolvedEndDate) cc.endDate = section.resolvedEndDate;
        if (!task.endTime && section.resolvedEndTime) cc.endTime = section.resolvedEndTime;
        if (!task.due && section.resolvedDue) cc.due = section.resolvedDue;
        if (!task.color && section.resolvedColor) cc.color = section.resolvedColor;
        if (!task.linestyle && section.resolvedLinestyle) cc.linestyle = section.resolvedLinestyle;
        if (!task.mask && section.resolvedMask) cc.mask = section.resolvedMask;
        if (section.resolvedTags && section.resolvedTags.length > 0) cc.tags = section.resolvedTags;
        if (Object.keys(section.resolvedProperties).length > 0) cc.properties = section.resolvedProperties;
        if (Object.keys(cc).length > 0) task.cascadeContext = cc;
    }

    /**
     * The child lines of the row at `line`: its subtree's lines, less its
     * child rows' subtrees and its own `flowLines`, dedented by the least
     * indentation of the subtree's non-blank lines.
     */
    private static childLines(outline: OutlineReading, line: number, rows: ReadonlyMap<number, Task>, flowLines: readonly number[]) {
        const { lines } = outline;
        const end = outline.subtreeEnd(line);
        const flow = new Set(flowLines);

        let minIndent = Infinity;
        for (let i = line + 1; i < end; i++) {
            if (lines[i].trim() !== '') minIndent = Math.min(minIndent, Outline.indentOf(lines[i]).length);
        }

        const texts: string[] = [];
        const numbers: number[] = [];
        for (let i = line + 1; i < end; i++) {
            // A child row goes with its own subtree: none of it is this row's.
            if (rows.has(i)) {
                i = outline.subtreeEnd(i) - 1;
                continue;
            }
            if (flow.has(i)) continue;
            texts.push(lines[i].trim() === '' ? lines[i] : lines[i].substring(minIndent));
            numbers.push(i);
        }
        return ChildLineClassifier.classifyLines(texts, numbers);
    }
}
