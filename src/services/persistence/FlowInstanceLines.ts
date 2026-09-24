import { collectFlowLineIndicesInFile, formatFlowLine } from '../parsing/utils/FlowLineScanner';
import { FileOperations } from './utils/FileOperations';
import { Outline } from '../parsing/utils/Outline';
import { Block, type PlacedLine, type Spot } from './utils/Placement';

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
 * Pure, and reading only: it answers the lines to write, each with how it is
 * to read once written (`checkWrite`), and touches nothing. The instance
 * is a sibling of the row that fired: its first line stands under the spot's
 * parent, its `==>` lines under it, a generated child under the line one
 * depth up.
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
    spot: Spot,
): PlacedLine[] {
    return insert.kind === 'recurrence'
        ? renderRecurrence(lines, currentLine, spot.indent, insert.content, insert.flowLines)
        : renderGenerated(lines, currentLine, spot.indent, insert.parentLine, insert.flowLines, insert.children);
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
    indent: string,
    content: string,
    flowLines: string[],
): PlacedLine[] {
    // At the indentation of the sibling it goes above (`Placement.groupHead`).
    const newParentLine = indent + Outline.dedent(content);

    const flowAbs = new Set(collectFlowLineIndicesInFile(lines, currentLine));
    const sample = FileOperations.firstChildIndent(lines, currentLine, flowAbs)
        ?? FileOperations.firstChildIndent(lines, currentLine);
    const childIndent = Outline.childIndent(newParentLine, sample, FileOperations.detectIndentUnit(lines));

    return [
        { text: newParentLine, kind: 'item', under: 'spot' },
        ...flowLines.map((raw): PlacedLine => ({ text: formatFlowLine(childIndent, raw), kind: 'item', under: 0 })),
    ];
}

/**
 * The next instance as a generation block wrote it.
 *
 * Indentation is resolved from the file, not from the caller. The parent is a
 * sibling of the task that fired, at the indentation of the sibling it goes
 * above (`Placement.groupHead`). Each
 * child is a child of the line above it one `depth` up (the parent for a
 * depth of 1), indented by the one rule for a child (`Outline.childIndent`):
 * as far past that line as the fired task's first child is past the task,
 * where that lands as a child, the file's unit otherwise — so a subtree keeps
 * one spelling, and a tab and spaces mixed do not cut a child loose.
 */
function renderGenerated(
    lines: readonly string[],
    currentLine: number,
    indent: string,
    parentLine: string,
    flowLines: string[],
    children: GeneratedChild[],
): PlacedLine[] {
    const parentIndent = Outline.indentOf(lines[currentLine]);
    const unit = FileOperations.detectIndentUnit(lines);
    const firstChild = FileOperations.resolveChildIndent(lines, currentLine);
    // How far a child stands past its parent, as the fired task's first
    // child is written; the file's unit where it is not written past it.
    const step = firstChild.startsWith(parentIndent) && firstChild.length > parentIndent.length
        ? firstChild.slice(parentIndent.length)
        : unit;
    const under = (line: string) => Outline.childIndent(line, Outline.indentOf(line) + step, unit);

    const head = indent + Outline.dedent(parentLine);
    const block: PlacedLine[] = [
        { text: head, kind: 'item', under: 'spot' },
        ...flowLines.map((raw): PlacedLine => ({ text: formatFlowLine(under(head), raw), kind: 'item', under: 0 })),
    ];
    // The parent and each child, with its depth and its line in the block.
    const levels: Array<{ depth: number; at: number }> = [{ depth: 0, at: 0 }];
    for (const child of children) {
        const depth = Math.max(1, child.depth);
        const parent = levels.filter(level => level.depth < depth).pop()!;
        const text = under(block[parent.at].text) + Outline.dedent(child.body);
        // A child reads as its body does by itself: a list item under the
        // line one depth up, or a line of text.
        const [reads] = Block.line(text);
        levels.push({ depth, at: block.length });
        block.push({ ...reads, under: reads.under === undefined ? undefined : parent.at });
    }
    return block;
}
