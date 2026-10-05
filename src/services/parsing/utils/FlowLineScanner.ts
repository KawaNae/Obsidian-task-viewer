/**
 * A task's flow program as the note writes it: the task line's `==>` tail
 * and the `- ==> ...` lines directly under the task (see TaskFlow in
 * types/Flow.ts).
 *
 * Pure, obsidian-free. The SINGLE implementation of "which lines carry a
 * task's flow" (`collectFlowLineIndices`) and of "what program they say"
 * (`readFlow`): the extraction (`NoteTasks`), the write layer (`RowBasis`,
 * `Carry`, `FlowInstanceLines`, `InlineTaskWriter`) and the editor
 * diagnostics (`DiagnosticsExtension`) all ask these — do not assemble a
 * flow anywhere else.
 */

import { LIST_BULLET_SOURCE, SPACE_OR_TAB_SOURCE } from './ListMarker';
import { INDENT_SOURCE, type OutlineReading } from './Outline';
import { TaskLineClassifier } from './TaskLineClassifier';
import { IN_LINE } from '../../../utils/LineBreak';
import type { ReadFlow } from '../../../types';
import { parseFlowSegments } from '../../lang/flow/FlowSegments';

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

/**
 * `text` cut at its first marker that has text after it (`FLOW_SPLIT`):
 * the index the marker stands at, and the text after it as it is written,
 * untrimmed. Null when no marker has. What stands before the marker is the
 * text a parser reads as the task's content; what stands after is the
 * command, which only {@link readFlow} reads.
 */
export function cutFlowTail(text: string): { marker: number; tail: string } | null {
    const m = FLOW_SPLIT.exec(text);
    return m ? { marker: m.index, tail: m[1] } : null;
}

/**
 * The command on the task line `line`: {@link cutFlowTail} of the line with
 * its `^id` taken off first (`extractLineBlockId`) — the `^id` is no part of
 * the command. The marker's index is its column in the line.
 */
export function taskLineFlowTail(line: string): { marker: number; tail: string } | null {
    return cutFlowTail(TaskLineClassifier.extractLineBlockId(line).text);
}

/**
 * `- ==> <tail>` with any list bullet. Group 1 = indent, group 2 = tail.
 * The marker is followed by spaces and tabs as a list item's is
 * (`Outline.read`): `-==>` and a no-break space after the marker open no
 * item, and are no command.
 */
export const FLOW_LINE_RE = new RegExp(`^(${INDENT_SOURCE})${LIST_BULLET_SOURCE}${SPACE_OR_TAB_SOURCE}+==>\\s?(${IN_LINE}*)$`);

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
 * outline reads directly under the task's own item, and is not code
 * (`OutlineReading.directItems`). A flow line under
 * a child checkbox, a bare checkbox or a plain note bullet belongs to that
 * item (a checkbox collects its own); a `- ==>` written inside a code block
 * is an example, not a command; a line the outline reads as a paragraph
 * going on is no item, and no command.
 */
export function collectFlowLineIndices(outline: OutlineReading, taskLine: number): number[] {
    return outline.directItems(taskLine).filter(line => isFlowLine(outline.lines[line]));
}

/**
 * The flow program of the task at `taskLine`, read once: the task line's
 * tail ({@link taskLineFlowTail}) and the task's own flow lines
 * ({@link collectFlowLineIndices}), trimmed, joined in document order and
 * parsed as one source (`parseFlowSegments`). Undefined when the task has
 * no command at all. The one place a flow program is built from a note:
 * the extraction reads a task's flow with it, and the editor's diagnostics
 * grade the same program.
 */
export function readFlow(outline: OutlineReading, taskLine: number): ReadFlow | undefined {
    const raw = taskLineFlowTail(outline.lines[taskLine])?.tail.trim() ?? '';
    const childSegments = collectFlowLineIndices(outline, taskLine)
        .map(line => ({ raw: flowLineTail(outline.lines[line]) ?? '', bodyLine: line }));
    if (raw === '' && childSegments.length === 0) return undefined;
    const { program, diagnostics } = parseFlowSegments([raw, ...childSegments.map(segment => segment.raw)]);
    return { raw, childSegments, program, diagnostics };
}

/** Canonical physical form of a flow child line. */
export function formatFlowLine(indent: string, raw: string): string {
    return `${indent}- ==> ${raw}`;
}
