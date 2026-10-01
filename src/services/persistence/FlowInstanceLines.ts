import { collectFlowLineIndices, formatFlowLine } from '../parsing/utils/FlowLineScanner';
import { Outline, type OutlineReading } from '../parsing/utils/Outline';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
import { Block, Placement, type PlacedLine } from './utils/Placement';

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
 * The next instance a firing writes: its first line (`head`, a task line
 * carrying no indentation, its flow clause composed), the `==>` lines under
 * it, and the children a generation block wrote (none for a plain
 * recurrence).
 *
 * The lines are finished text, still unplaced, because indentation is read
 * from the file rather than decided by the caller. One shape for every next
 * instance, whoever wrote it — the planner formats a recurrence's task once
 * (`create-instance`) — so there is one way to draw it
 * ({@link renderFlowInstance}), and a firing which also removes the original
 * hands everything it wants written to one write, which resolves the
 * original's line exactly once.
 */
export interface FlowInstance {
    head: string;
    flowLines: string[];
    children: GeneratedChild[];
}

/**
 * Render the next instance against the file it is going into.
 *
 * Pure, and reading only: it answers the lines to write, each with how it is
 * to read once written (`checkWrite`), and touches nothing. The instance
 * is a sibling of the row that fired: its first line stands under the spot's
 * parent, its `==>` lines under it, a child under the line one depth up
 * (the first line for a depth of 1). It is written where the row stands, at
 * the row's indentation and spelled with the row's marker and gap
 * (`spelledAsFired`); the put carries it to the spot's indentation
 * (`Block.at`). Every instance a fire writes — a completion's and a
 * deletion's alike — comes as an `insert-instance` op and is rendered here.
 *
 * The `==>` lines and children are indented as a child of the row that fired
 * would be under the line they go under (`Placement.resolveChildIndent`): the
 * spelling is taken from the fired row's children, its own `==>` lines last,
 * being the ones the fire consumes. So a subtree keeps one spelling, a tab
 * and spaces mixed do not cut a child loose, and the `==>` lines are children
 * of the line written, not of the one that fired — were the two to open their
 * content at different columns, indented for the one that fired they would be
 * a paragraph under the one written, the series cut off.
 *
 * `currentLine` is the original's line in the lines `outline` reads, already
 * resolved by the caller. Nothing here searches for it: a search after a line
 * has been written is what hands a copy the original's place.
 *
 * `unit` is the indentation of a new level, as Obsidian's settings say
 * (`ObsidianConfig.indentUnit`): what a child takes where the row that fired
 * has none to copy (`Placement.resolveChildIndent`).
 */
export function renderFlowInstance(
    outline: OutlineReading,
    currentLine: number,
    instance: FlowInstance,
    unit: string,
): PlacedLine[] {
    const head = spelledAsFired(outline.lines[currentLine], instance.head);
    const flowAbs = new Set(collectFlowLineIndices(outline, currentLine));
    const under = (line: string) => Placement.resolveChildIndent(outline, currentLine, unit, line, flowAbs);

    const block: PlacedLine[] = [
        { text: head, kind: 'item', under: 'spot' },
        ...instance.flowLines.map((raw): PlacedLine => ({ text: formatFlowLine(under(head), raw), kind: 'item', under: 0 })),
    ];
    // The first line and each child, with its depth and its line in the block.
    const levels: Array<{ depth: number; at: number }> = [{ depth: 0, at: 0 }];
    for (const child of instance.children) {
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
