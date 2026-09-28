import type { OutlineReading } from '../../parsing/utils/Outline';
import type { Spot } from './Placement';

/** An ordered item's marker: its number and its delimiter, past its indentation. */
const ORDERED_RE = /^([ \t]*)(\d+)([.)])/;

/**
 * The number an ordered item takes where a write puts it, so the item reads
 * as one there and goes on the list it lands in.
 *
 * CommonMark lets an ordered item interrupt a paragraph only when it starts
 * at 1 (`structure.md`, the rules of where lines go). An item put straight
 * below an ordered sibling, with its delimiter, goes on that list, and takes
 * the number after it; anywhere else it opens a list of its own, at 1. A
 * bullet is written as it is.
 */
export const ListNumber = {
    /**
     * `head` as it can stand anywhere: numbered 1 when it is ordered. The
     * head to ask where it goes with (`Placement`), before it is numbered
     * where it lands ({@link at}): a number past 1 would not read as an item
     * past a paragraph, and the answer would be asked of a line that is none.
     */
    first(head: string): string {
        return head.replace(ORDERED_RE, (_m, indent: string, _n: string, delimiter: string) => `${indent}1${delimiter}`);
    },

    /**
     * `head`, put at `spot`, numbered as it goes there, and how many columns
     * that moved its content right (a number of more digits than it had):
     * the lines below it that stood in it go that much further, or they would
     * stand short of its content and out of it. A number of fewer digits
     * moves the content left, and those lines stay in it as they are.
     *
     * `leaving` is the lines the write takes away from where they stood, the
     * item's own when it is carried: the item just above the spot is looked
     * for as it stands once they are gone.
     */
    at(outline: OutlineReading, spot: Spot, head: string, leaving?: { from: number; to: number }): { text: string; shift: number } {
        const own = ORDERED_RE.exec(head);
        if (!own) return { text: head, shift: 0 };
        const [, indent, written, delimiter] = own;
        const above = orderedAbove(outline, spot, leaving?.to === spot.at ? leaving.from : spot.at);
        const number = above !== null && above.delimiter === delimiter ? above.number + 1 : 1;
        const text = `${indent}${number}${delimiter}${head.slice(own[0].length)}`;
        return { text, shift: Math.max(String(number).length - written.length, 0) };
    },
};

/**
 * The ordered item a line put at `at` under `spot.parent` goes straight
 * below: the sibling whose subtree ends at `at` — an item of the same list
 * level, as the outline reads it. Null when there is none, or it is a
 * bullet.
 */
function orderedAbove(outline: OutlineReading, spot: Spot, at: number): { number: number; delimiter: string } | null {
    for (let up = at > 0 ? outline.ownerOf(at - 1) : null; up !== null && up !== spot.parent; up = outline.item(up)!.parent) {
        if (outline.item(up)!.parent !== spot.parent) continue;
        if (outline.subtreeEnd(up) !== at) return null;
        const marker = ORDERED_RE.exec(outline.lines[up]);
        return marker ? { number: Number(marker[2]), delimiter: marker[3] } : null;
    }
    return null;
}
