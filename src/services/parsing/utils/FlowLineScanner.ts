/**
 * Recognition of `- ==> ...` flow child lines — the multi-line physical
 * form of a flow program (see TaskFlow in types/index.ts).
 *
 * Pure, obsidian-free. This is the SINGLE implementation of "which child
 * lines carry a task's flow"; the extractor (TreeTaskExtractor), the write
 * layer (InlineTaskWriter / TaskCloner) and the editor diagnostics
 * (DiagnosticsExtension) all share it — do not duplicate the judgment.
 */

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
 * The flow child lines of the task at `taskLine`, as absolute line numbers.
 *
 * Ownership rule: a flow line belongs to the task iff it is a list item the
 * outline reads directly under the task's own item
 * (`OutlineReading.item(line).parent`), and is not code. A flow line under
 * a child checkbox, a bare checkbox or a plain note bullet belongs to that
 * item (a checkbox collects its own); a `- ==>` written inside a code block
 * is an example, not a command; a line the outline reads as a paragraph
 * going on is no item, and no command.
 */
export function collectFlowLineIndices(outline: OutlineReading, taskLine: number): number[] {
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
 * lines and no reading of them yet: reads them (`Outline.read`).
 */
export function collectFlowLineIndicesInFile(lines: readonly string[], taskLine: number): number[] {
    return collectFlowLineIndices(Outline.read(lines), taskLine);
}

/** Canonical physical form of a flow child line. */
export function formatFlowLine(indent: string, raw: string): string {
    return `${indent}- ==> ${raw}`;
}
