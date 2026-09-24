import { collectFlowLineIndicesInFile, formatFlowLine } from '../parsing/utils/FlowLineScanner';
import { FileOperations } from './utils/FileOperations';
import { Outline } from '../parsing/utils/Outline';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
import { Block, type PlacedLine } from './utils/Placement';

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

/** The first line of the next instance, the one it is placed by (`Placement.groupHead`). */
export function flowInstanceHead(insert: FlowInstanceInsert): string {
    return insert.kind === 'recurrence' ? insert.content : insert.parentLine;
}

/**
 * Render the next instance against the file it is going into.
 *
 * Pure, and reading only: it answers the lines to write, each with how it is
 * to read once written (`checkWrite`), and touches nothing. The instance
 * is a sibling of the row that fired: its first line stands under the spot's
 * parent, its `==>` lines under it, a generated child under the line one
 * depth up. It is written where the row stands, at the row's indentation and
 * spelled with the row's marker and gap (`spelledAsFired`); the put carries
 * it to the spot's indentation (`Block.at`).
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
): PlacedLine[] {
    const head = spelledAsFired(lines[currentLine], flowInstanceHead(insert));
    return insert.kind === 'recurrence'
        ? renderRecurrence(lines, currentLine, head, insert.flowLines)
        : renderGenerated(lines, currentLine, head, insert.flowLines, insert.children);
}

/**
 * The next instance's first line, spelled as the row that fired: at its
 * indentation, with its list marker and the gap after it
 * (`TaskLineClassifier.extractMarker`), and the rest as `head` reads. The
 * instance is written from a task that has no line of its own, so `head`
 * opens with `- ` whatever the row wrote (L2's H2): `*`, `+` and `1)` came
 * back as `- `, and a row whose content opens far from its marker
 * (`10.   [ ] T`) got a next instance whose content opens two columns in.
 * Spelled as the row, the instance opens its content where the row did, and
 * reads as the row's sibling does. A head that is no task line is written as
 * it is, at the row's indentation.
 *
 * The marker is one that can interrupt a paragraph, since the instance goes
 * in at the head of the row's group, which can be just past the text of the
 * item above (CommonMark: an ordered item interrupts a paragraph only when it
 * starts at 1). So an ordered row's instance is numbered 1, with the row's
 * delimiter and gap; a bullet is the row's own. A number shorter than the
 * row's moves the content left of the row's; the `==>` lines and generated
 * children stay at the columns they are resolved to under the row, as a
 * child of an item may stand past its content column.
 */
function spelledAsFired(fired: string, head: string): string {
    const indent = Outline.indentOf(fired);
    const task = TaskLineClassifier.classify(head);
    if (!task) return indent + Outline.dedent(head);
    const marker = TaskLineClassifier.extractMarker(fired).replace(/^\d+(?=[.)])/, '1');
    return indent + marker + '[' + task.statusChar + task.suffix;
}

/**
 * The next instance of a recurrence, spelled like the line that fired
 * (`newParentLine`).
 *
 * Its `==>` lines are children of the line written, not of the one that
 * fired: were the two to open their content at different columns, indented
 * for the one that fired they would be a paragraph under the one written, the
 * series cut off. The spelling is taken from the fired row's children, its
 * own `==>` lines last, being the ones the fire consumes
 * (`FileOperations.resolveChildIndent`).
 */
function renderRecurrence(
    lines: readonly string[],
    currentLine: number,
    newParentLine: string,
    flowLines: string[],
): PlacedLine[] {

    const flowAbs = new Set(collectFlowLineIndicesInFile(lines, currentLine));
    const childIndent = FileOperations.resolveChildIndent(lines, currentLine, newParentLine, flowAbs);

    return [
        { text: newParentLine, kind: 'item', under: 'spot' },
        ...flowLines.map((raw): PlacedLine => ({ text: formatFlowLine(childIndent, raw), kind: 'item', under: 0 })),
    ];
}

/**
 * The next instance as a generation block wrote it.
 *
 * Indentation is resolved from the file, not from the caller. The parent is a
 * sibling of the task that fired, spelled as it (`head`). Each
 * child is a child of the line above it one `depth` up (the parent for a
 * depth of 1), indented as a child of the fired task would be under that line
 * (`FileOperations.resolveChildIndent`) — so a subtree keeps one spelling, and
 * a tab and spaces mixed do not cut a child loose.
 */
function renderGenerated(
    lines: readonly string[],
    currentLine: number,
    head: string,
    flowLines: string[],
    children: GeneratedChild[],
): PlacedLine[] {
    const flowAbs = new Set(collectFlowLineIndicesInFile(lines, currentLine));
    const under = (line: string) => FileOperations.resolveChildIndent(lines, currentLine, line, flowAbs);

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
