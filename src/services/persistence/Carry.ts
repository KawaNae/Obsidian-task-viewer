import { collectFlowLineIndices } from '../parsing/utils/FlowLineScanner';
import { Outline, type OutlineReading } from '../parsing/utils/Outline';
import { UnfollowableDraft, type LineDraft } from './FileLines';
import { Block, type PlacedLine, type Spot } from './utils/Placement';
import { ListNumber } from './utils/ListNumber';

/**
 * What a carry does with the row's own `- ==>` lines: a flow's move leaves
 * them behind, consumed by the fire that moves the row (`drop`); a send
 * carries them as any line of the subtree (`carry`), to fire at the row's
 * next completion where it lands.
 */
export type CarriedFlow = 'drop' | 'carry';

/**
 * Carry the row at `line` and its subtree to `spot`, and take them away from
 * where they stood, inside a write: the one way a row moves within its note
 * — a flow's move (`TaskOp` `move`) and a send to a section of the same note
 * (`SendWriter`).
 *
 * The lines are carried, not copied (`LineDraft.put` with `from`): they are
 * the rows they were, each with its `^id` and its name, and a write that
 * asks for one of them afterwards finds it where it landed
 * (`WriteSession.row`). The row reads `head` where it lands (its
 * indentation aside), as it stands when none is given; an ordered row is
 * numbered there (`ListNumber.at`), and its lines shift with its content.
 * Every other line is written as it stands, and reads, once written, as it
 * read under the row (`Block.of`).
 *
 * `spot` is where the caller asked `Placement` to put the row, with the row
 * as it is to read there, numbered 1 when it is ordered
 * (`ListNumber.first`). It is never inside the subtree: a section's head
 * and end, and a spot past a subtree at the top, are past no item's text.
 * One inside is a caller's bug (`UnfollowableDraft`). The subtree is then
 * where it was, or below the carried lines when they went above it, and is
 * taken away from there.
 */
export function carryTo(draft: LineDraft, line: number, spot: Spot, opts: { head?: string; flow: CarriedFlow }): void {
    const outline = draft.reading();
    const end = outline.subtreeEnd(line);
    if (spot.at > line && spot.at < end) {
        throw new UnfollowableDraft(`a row at line ${line} carried to line ${spot.at}, inside its own subtree`);
    }
    const block = carriedWith(outline, line, opts.head ?? outline.lines[line], opts.flow);
    putNumbered(draft, spot, block, { from: line, to: end });
    draft.splice(spot.at <= line ? line + block.length : line, end - line);
}

/**
 * The row at `line` of `outline` and its subtree, as lines to put in another
 * note: new lines there, each to read, once written, as it read under the
 * row (`Block.of`), written as it stands, the row's own indentation before
 * it. What a send puts in the note it sends a row to (`SendWriter`), which
 * then puts it where a carry would ({@link putNumbered}): the row's lines go,
 * `==>` and all, as a send carries them within its note.
 */
export function subtreeBlock(outline: OutlineReading, line: number): PlacedLine[] {
    const rows: number[] = [];
    for (let at = line; at < outline.subtreeEnd(line); at++) rows.push(at);
    return Block.of(outline, rows, rows.map(at => outline.lines[at]));
}

/**
 * Put `block` at `spot`, its first line numbered where it lands
 * (`ListNumber.at`), and the lines below it moved as far right as that moved
 * its content, so they stand in it still. `leaving` is the lines the write
 * takes away from where they stood, the block's own when it is carried
 * ({@link carryTo}).
 */
export function putNumbered(draft: LineDraft, spot: Spot, block: readonly PlacedLine[], leaving?: { from: number; to: number }): void {
    const numbered = ListNumber.at(draft.reading(), spot, block[0].text, leaving);
    draft.put(spot, numberedBlock(block, numbered));
}

/**
 * The row, written as `head`, and the lines of its subtree that go with it,
 * carried: to read, once written, as they read under the row (`Block.of`),
 * written as they stand, the row's own indentation before `head`
 * (`format` writes none). They are the rows they were, so each keeps its
 * `^id`: only a write that makes a copy takes a copy's off (`TaskOp` `copies`).
 *
 * With `drop`, the row's own direct `- ==>` lines do not travel with it:
 * the fire that moves it consumes them. Descendant tasks' flow lines are
 * not direct (structural-parent rule) and go with it as templates. A line
 * that stood under one of the dropped lines has lost its item: a task,
 * command or property there is not written (`checkWrite`).
 */
function carriedWith(outline: OutlineReading, row: number, head: string, flow: CarriedFlow): PlacedLine[] {
    const lines = outline.lines;
    const dropped = new Set(flow === 'drop' ? collectFlowLineIndices(outline, row) : []);
    const rows = [row];
    for (let at = row + 1; at < outline.subtreeEnd(row); at++) {
        if (!dropped.has(at)) rows.push(at);
    }
    const texts = [Outline.indentOf(lines[row]) + Outline.dedent(head), ...rows.slice(1).map(at => lines[at])];
    return Block.of(outline, rows, texts, true);
}

/**
 * A carried block with its first line numbered where it lands
 * (`ListNumber.at`), and the lines below it moved as far right as that moved
 * its content, so they stand in it still.
 */
function numberedBlock(block: readonly PlacedLine[], numbered: { text: string; shift: number }): PlacedLine[] {
    const frame = Outline.indentOf(block[0].text);
    const deeper = frame + ' '.repeat(numbered.shift);
    return block.map((line, i) => ({
        ...line,
        text: i === 0 ? numbered.text : Outline.shiftIndent(line.text, frame, deeper),
    }));
}
