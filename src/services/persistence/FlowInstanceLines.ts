import { collectFlowLineIndicesInFile, formatFlowLine } from '../parsing/utils/FlowLineScanner';
import { FileOperations } from './utils/FileOperations';
import { Outline } from '../parsing/utils/Outline';

/**
 * One generated child line, as the block described it.
 *
 * `depth` counts levels below the generated parent, so 1 is its direct child.
 * `body` carries no indentation — this layer decides what one level looks like
 * in the file being written.
 */
export interface GeneratedChild {
    depth: number;
    body: string;
}

/**
 * The next instance a firing writes, in the form the writer needs.
 *
 * This is what a `create-next` or `create-generated` effect becomes once the
 * interpreter has formatted it: the lines themselves are still unrendered,
 * because indentation is read from the file rather than decided by the caller.
 *
 * It exists so that a firing which also removes the original can hand over
 * everything it wants written in one call, and the writer can resolve the
 * original's line exactly once. See {@link renderFlowInstance}.
 */
export type FlowInstanceInsert =
    | { kind: 'recurrence'; content: string; flowLines: string[] }
    | {
        kind: 'generated';
        parentLine: string;
        flowLines: string[];
        children: GeneratedChild[];
    };

/**
 * Render the next instance against the file it is going into.
 *
 * Pure, and reading only: it answers the lines to write and touches nothing.
 * Both the plain insert and the insert-and-remove of a deletion fire render
 * through here, so the two paths cannot drift into writing different lines for
 * the same effect — which is the whole reason this is not a method on the
 * writer that happens to call it.
 *
 * `currentLine` is the original's line in `lines`, already resolved by the
 * caller. Nothing here searches for it: a search after a line has been written
 * is what hands a copy the original's place.
 */
export function renderFlowInstance(
    fileOps: FileOperations,
    lines: readonly string[],
    currentLine: number,
    insert: FlowInstanceInsert,
): string[] {
    return insert.kind === 'recurrence'
        ? renderRecurrence(lines, currentLine, insert.content, insert.flowLines)
        : renderGenerated(lines, currentLine, insert.parentLine, insert.flowLines, insert.children);
}

/**
 * The next instance of a recurrence, indented like the line that fired.
 *
 * Its `==>` lines are children of the line written, not of the one that
 * fired: the two can open their content at different columns (`10.   [ ] T`
 * is written back as `- [ ] T`, L2's H2), and indented for the one that
 * fired they would be a paragraph under the one written, the series cut off.
 * The spelling is taken from the fired row's children (its own `==>` lines
 * last, being the ones the fire consumes) where it lands as a child of the
 * line written (`Outline.childIndent`).
 */
function renderRecurrence(
    lines: readonly string[],
    currentLine: number,
    content: string,
    flowLines: string[],
): string[] {
    // Re-indent the formatted line to match the original task line
    const originalIndent = Outline.indentOf(lines[currentLine]);
    const newParentLine = originalIndent + Outline.dedent(content);

    const flowAbs = new Set(collectFlowLineIndicesInFile(lines, currentLine));
    const sample = FileOperations.firstChildIndent(lines, currentLine, flowAbs)
        ?? FileOperations.firstChildIndent(lines, currentLine);
    const childIndent = Outline.childIndent(newParentLine, sample, FileOperations.detectIndentUnit(lines));

    return [newParentLine, ...flowLines.map(raw => formatFlowLine(childIndent, raw))];
}

/**
 * The next instance as a generation block wrote it.
 *
 * Indentation is resolved from the file, not from the caller. The parent is a
 * sibling of the task that fired, so it takes that task's own indent. Each
 * child is a child of the line above it one `depth` up (the parent for a
 * depth of 1), indented by the one rule for a child (`Outline.childIndent`):
 * as far past that line as the fired task's first child is past the task,
 * where that lands as a child, the file's unit otherwise — so a subtree keeps
 * one spelling, and a tab and spaces mixed do not cut a child loose.
 */
function renderGenerated(
    lines: readonly string[],
    currentLine: number,
    parentLine: string,
    flowLines: string[],
    children: GeneratedChild[],
): string[] {
    const parentIndent = Outline.indentOf(lines[currentLine]);
    const unit = FileOperations.detectIndentUnit(lines);
    const firstChild = FileOperations.resolveChildIndent(lines, currentLine);
    // How far a child stands past its parent, as the fired task's first
    // child is written; the file's unit where it is not written past it.
    const step = firstChild.startsWith(parentIndent) && firstChild.length > parentIndent.length
        ? firstChild.slice(parentIndent.length)
        : unit;
    const under = (line: string) => Outline.childIndent(line, Outline.indentOf(line) + step, unit);

    const head = parentIndent + Outline.dedent(parentLine);
    const written: Array<{ depth: number; text: string }> = [{ depth: 0, text: head }];
    for (const child of children) {
        const depth = Math.max(1, child.depth);
        const parent = written.filter(line => line.depth < depth).pop()!;
        written.push({ depth, text: under(parent.text) + Outline.dedent(child.body) });
    }

    return [
        head,
        ...flowLines.map(raw => formatFlowLine(under(head), raw)),
        ...written.slice(1).map(line => line.text),
    ];
}
