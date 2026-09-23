import { collectFlowLineIndicesInFile, formatFlowLine } from '../flow/FlowLineScanner';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
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
        ? renderRecurrence(fileOps, lines, currentLine, insert.content, insert.flowLines)
        : renderGenerated(lines, currentLine, insert.parentLine, insert.flowLines, insert.children);
}

/**
 * The next instance of a recurrence, indented like the line that fired.
 *
 * 新インスタンスの flow 行インデント: 既存子行の綴りに揃え、なければタブ。
 * 直下の flow 行は発火で消費される側なので、綴りの見本としては後回しにする
 * （それしか無ければ使う）。
 */
function renderRecurrence(
    fileOps: FileOperations,
    lines: readonly string[],
    currentLine: number,
    content: string,
    flowLines: string[],
): string[] {
    // Re-indent the formatted line to match the original task line
    const originalIndent = Outline.indentOf(lines[currentLine]);
    const newParentLine = originalIndent + TaskLineClassifier.tidy(content);

    const flowAbs = new Set(collectFlowLineIndicesInFile(lines, currentLine));
    const { childrenLines } = fileOps.collectChildrenFromLines(lines, currentLine);
    const ordinaryChildren = childrenLines.filter((_, i) => !flowAbs.has(currentLine + 1 + i));

    const firstIndent = (children: string[]) => {
        const first = children.find(l => l.trim() !== '');
        return first === undefined ? undefined : Outline.indentOf(first);
    };
    const childIndent = firstIndent(ordinaryChildren)
        ?? firstIndent(childrenLines)
        ?? originalIndent + '\t';

    return [newParentLine, ...flowLines.map(raw => formatFlowLine(childIndent, raw))];
}

/**
 * The next instance as a generation block wrote it.
 *
 * Indentation is resolved from the file, not from the caller. The parent is a
 * sibling of the task that fired, so it takes that task's own indent; the
 * children take one unit per level of `depth`, where a depth of 1 means the
 * first level below the parent. The unit follows the task's existing children,
 * falling back to however the rest of the file is written — the same rule the
 * child-insert primitives use, so a subtree keeps one spelling.
 */
function renderGenerated(
    lines: readonly string[],
    currentLine: number,
    parentLine: string,
    flowLines: string[],
    children: GeneratedChild[],
): string[] {
    const parentIndent = Outline.indentOf(lines[currentLine]);
    const unit = FileOperations.resolveChildIndent(lines, currentLine).slice(parentIndent.length)
        || FileOperations.detectIndentUnit(lines);

    return [
        parentIndent + TaskLineClassifier.tidy(parentLine),
        ...flowLines.map(raw => formatFlowLine(parentIndent + unit, raw)),
        ...children.map(c => parentIndent + unit.repeat(Math.max(1, c.depth)) + TaskLineClassifier.tidy(c.body)),
    ];
}
