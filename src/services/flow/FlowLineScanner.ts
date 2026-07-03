/**
 * Recognition of `- ==> ...` flow child lines — the multi-line physical
 * form of a flow program (see TaskFlow in types/index.ts).
 *
 * Pure, obsidian-free. This is the SINGLE implementation of "which child
 * lines carry a task's flow"; the extractor (TreeTaskExtractor), the write
 * layer (InlineTaskWriter / TaskCloner) and the editor diagnostics
 * (DiagnosticsExtension) all share it — do not duplicate the judgment.
 */

/** `- ==> <tail>` with any list bullet. Group 1 = indent, group 2 = tail. */
export const FLOW_LINE_RE = /^(\s*)(?:[-*+]|\d+[.)])\s*==>\s?(.*)$/;

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
 * The scan covers the task's child block: consecutive non-blank lines with
 * indent strictly greater than the task line (a blank line ends the block —
 * same convention as FileOperations.collectChildrenFromLines and
 * DocumentTreeBuilder).
 */
export function collectFlowLineIndices(lines: string[], taskLineIndex: number): number[] {
    const taskIndent = lines[taskLineIndex].search(/\S|$/);
    const result: number[] = [];

    // Monotonic stack of ancestor indents; depth 1 = the task line itself.
    const ancestorIndents: number[] = [taskIndent];

    for (let j = taskLineIndex + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '') break;
        const indent = line.search(/\S|$/);
        if (indent <= taskIndent) break;

        while (ancestorIndents.length > 1 && ancestorIndents[ancestorIndents.length - 1] >= indent) {
            ancestorIndents.pop();
        }
        const parentIsTaskLine = ancestorIndents.length === 1;
        if (parentIsTaskLine && isFlowLine(line)) {
            result.push(j);
        }
        ancestorIndents.push(indent);
    }

    return result;
}

/** Canonical physical form of a flow child line. */
export function formatFlowLine(indent: string, raw: string): string {
    return `${indent}- ==> ${raw}`;
}
