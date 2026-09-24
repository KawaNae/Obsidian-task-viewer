/**
 * Recognition of `- ==> ...` flow child lines — the multi-line physical
 * form of a flow program (see TaskFlow in types/index.ts).
 *
 * Pure, obsidian-free. This is the SINGLE implementation of "which child
 * lines carry a task's flow"; the extractor (TreeTaskExtractor), the write
 * layer (InlineTaskWriter / TaskCloner) and the editor diagnostics
 * (DiagnosticsExtension) all share it — do not duplicate the judgment.
 */

import { CodeFenceTracker } from '../../../utils/CodeFenceTracker';
import { LIST_BULLET_SOURCE } from './ListMarker';
import { INDENT_SOURCE, Outline, type OutlineReading } from './Outline';
import { IN_LINE } from '../../../utils/LineBreak';

/**
 * The marker that turns the tail of a line into a flow command, on a task
 * line as much as on a flow child line.
 */
export const FLOW_MARKER = '==>';

/**
 * Splits a task line at its first marker: `[before, command, after]`. The
 * command is the rest of the line, U+2028 and U+2029 included — with `.` it
 * stopped at one and the rest of the command was dropped.
 */
export const FLOW_SPLIT = new RegExp(`${FLOW_MARKER}(${IN_LINE}+)`);

/** `- ==> <tail>` with any list bullet. Group 1 = indent, group 2 = tail. */
export const FLOW_LINE_RE = new RegExp(`^(${INDENT_SOURCE})${LIST_BULLET_SOURCE}\\s*==>\\s?(${IN_LINE}*)$`);

export interface FlowLineMatch {
    /** Leading whitespace of the line. */
    indent: string;
    /** Char offset in the line where the (untrimmed) tail begins. */
    tailStart: number;
    /** Untrimmed text after the marker (spans map to editor columns via tailStart). */
    tail: string;
}

/** Structural match for editors/writers that need column offsets. */
export function matchFlowLine(line: string): FlowLineMatch | null {
    const m = line.match(FLOW_LINE_RE);
    if (!m) return null;
    return { indent: m[1], tailStart: line.length - m[2].length, tail: m[2] };
}

/** Trimmed flow tail of the line, or null when the line is not a flow line. */
export function flowLineTail(line: string): string | null {
    const m = line.match(FLOW_LINE_RE);
    return m ? m[2].trim() : null;
}

export function isFlowLine(line: string): boolean {
    return FLOW_LINE_RE.test(line);
}

/**
 * Indices (into `lines`) of the flow child lines owned by the task at
 * `taskLineIndex`.
 *
 * Ownership rule: a flow line belongs to the task iff its STRUCTURAL parent
 * is the task line — i.e. the nearest preceding non-blank line with smaller
 * indent is the task line itself. Flow lines nested under a child checkbox,
 * a bare checkbox, or a plain note bullet belong to that deeper structure
 * (checkbox owners collect them via their own scan; others leave them as
 * plain child lines).
 *
 * The scan covers the task's subtree as the parser and every write read it
 * (`Outline.subtreeEnd`): the lines deeper than the task line, blank lines
 * between them included.
 *
 * `fenced` is the parallel per-line code-fence mask. It is REQUIRED: a
 * `- ==>` written inside a fenced block is an example, not a command, and
 * every caller must answer that question the same way the checkbox scan
 * does. Callers holding whole-file lines can use
 * {@link collectFlowLineIndicesInFile}, which builds the mask itself.
 */
export function collectFlowLineIndices(
    lines: readonly string[],
    taskLineIndex: number,
    fenced: boolean[],
): number[] {
    const taskIndent = Outline.depthOf(lines[taskLineIndex]);
    const result: number[] = [];

    // Monotonic stack of ancestor indents; depth 1 = the task line itself.
    const ancestorIndents: number[] = [taskIndent];

    const end = Outline.subtreeEnd(lines, taskLineIndex);
    for (let j = taskLineIndex + 1; j < end; j++) {
        const line = lines[j];
        if (line.trim() === '') continue;
        const indent = Outline.depthOf(line);
        if (indent <= taskIndent) break;

        while (ancestorIndents.length > 1 && ancestorIndents[ancestorIndents.length - 1] >= indent) {
            ancestorIndents.pop();
        }
        const parentIsTaskLine = ancestorIndents.length === 1;
        if (parentIsTaskLine && !fenced[j] && isFlowLine(line)) {
            result.push(j);
        }
        ancestorIndents.push(indent);
    }

    return result;
}

/**
 * The flow child lines of the task at `taskLine`, as absolute line numbers:
 * the list items the outline reads directly under the task's own item
 * (`OutlineReading.item(line).parent`), not code, that are flow lines.
 * A flow line under a child checkbox, a bare checkbox or a plain note bullet
 * belongs to that item, not to the task.
 */
export function ownFlowLines(outline: OutlineReading, taskLine: number): number[] {
    const result: number[] = [];
    const end = outline.subtreeEnd(taskLine);
    for (let line = taskLine + 1; line < end; line++) {
        if (outline.item(line)?.parent !== taskLine || outline.inCode(line)) continue;
        if (isFlowLine(outline.lines[line])) result.push(line);
    }
    return result;
}

/**
 * {@link collectFlowLineIndices} for callers that hold the whole file's
 * lines: builds the fence mask itself, matching DocumentTreeBuilder's
 * judgment (document-level mask OR the dedented subtree mask, since a fence
 * nested under a task carries the list item's indentation).
 */
export function collectFlowLineIndicesInFile(lines: readonly string[], taskLineIndex: number): number[] {
    const documentMask = CodeFenceTracker.mask(lines);
    const subtreeMask = CodeFenceTracker.subtreeMask(lines.slice(taskLineIndex + 1));
    const fenced = lines.map((_, i) =>
        documentMask[i] || (i > taskLineIndex && subtreeMask[i - taskLineIndex - 1])
    );
    return collectFlowLineIndices(lines, taskLineIndex, fenced);
}

/** Canonical physical form of a flow child line. */
export function formatFlowLine(indent: string, raw: string): string {
    return `${indent}- ==> ${raw}`;
}
