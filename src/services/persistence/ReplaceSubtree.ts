import { Outline, type OutlineReading } from '../parsing/utils/Outline';
import { UnfollowableDraft, type LineDraft, type MarkedLine, type WriteSession } from './FileLines';
import type { PlacedLine } from './utils/Placement';
import type { SubtreeReplacement } from './TaskOps';

/**
 * A row a subtree's replacement rewrote: the row itself, or a child line it
 * kept and wrote another text on. `row` finds where it stands once the write
 * is done (`WriteSession.mark`); `was` and `now` are its line before and
 * after, from which the caller answers whether the write completed it.
 */
export interface RewrittenRow {
    row: MarkedLine;
    was: string;
    now: string;
}

/**
 * Write the row at `line` and its subtree as `replacement` says, inside a
 * write (`InlineTaskWriter.replaceSubtreeInFile`), and answer the rows it
 * rewrote, the row first.
 *
 * The row is rewritten, always: it is the row the draft was opened on, its
 * indentation the file's, and the hub that holds its name follows it
 * (`WriteLinks`). A child line the draft says it was (`SubtreeLine.was`) is
 * kept, and rewritten when its text changed, if it stands as it stood
 * ({@link keptLines}); every other line is new. The lines not kept are taken
 * out, and the new ones put where they stand in the lines as written
 * (`LineDraft.put`), each read off the reading of those lines.
 *
 * Where the lines go is the user's text, not a question `Placement` answers:
 * the replacement says the whole subtree, and the spot of each new line is
 * where it stands in it. The write's check still holds every line to what the
 * write says of it (`checkWrite`): a draft that changes a line outside the
 * subtree — a fence it opens and never closes, a paragraph below it taken in
 * — is refused whole as `disturbs`.
 *
 * The children have to be the row's subtree, as the lines written read, and
 * nothing else: a child line that ends the row's item (shallower than its
 * content, a blank line at the end) does not read as put, and the write is
 * refused as `unplaceable`; lines below the subtree that the children take
 * in (a paragraph they go on, a fence they open that never closes) are
 * another line's reading changed, `disturbs`. The check of the kept lines
 * does not ask this of a line that opens no item (`checkWrite`), so it is
 * asked here. The hub's check of its draft keeps the first from coming here
 * (`SubtreeFrame`). A `was` that names no line of the subtree is a caller's
 * bug (`UnfollowableDraft`).
 *
 * Answers false when the write is refused so, the reason said through the
 * session.
 */
export function replaceSubtree(draft: LineDraft, session: WriteSession, line: number, replacement: SubtreeReplacement): RewrittenRow[] | false {
    const before = draft.reading();
    const handed = [...draft.lines];
    const end = before.subtreeEnd(line);
    const children = replacement.children;
    for (const child of children) {
        if (child.was !== null && !(Number.isInteger(child.was) && child.was > 0 && line + child.was < end)) {
            throw new UnfollowableDraft(`a subtree line was line ${child.was} of a subtree of ${end - line} lines`);
        }
    }
    const top = Outline.indentOf(handed[line]) + Outline.dedent(replacement.text);
    const written = [...handed.slice(0, line), top, ...children.map(child => child.text), ...handed.slice(end)];
    const after = Outline.read(written);
    const last = line + children.length;
    const kept = keptLines(before, after, line, end, children.map(child => child.was));
    // The children are the row's subtree, and nothing below them is.
    if (after.subtreeEnd(line) < last + 1) return session.refuse({ kind: 'unplaceable', fence: null });
    if (after.subtreeEnd(line) > last + 1) return session.refuse({ kind: 'disturbs', fence: fenceTakingIn(after, line, last, kept) });

    // The row: rewritten where it stands, and nothing below it moves it.
    draft.rewrite(line, top);
    const rewritten: RewrittenRow[] = [{ row: session.mark(line), was: handed[line], now: top }];

    // The lines not kept, from the bottom, so each stands where it stood.
    const keptFrom = new Set(kept.values());
    for (let old = end - 1; old > line; old--) {
        if (keptFrom.has(old)) continue;
        let from = old;
        while (from - 1 > line && !keptFrom.has(from - 1)) from--;
        draft.splice(from, old - from + 1);
        old = from;
    }

    // The kept lines, now just below the row in their order: rewritten
    // where the draft gave them another text.
    let at = line + 1;
    for (let n = line + 1; n <= last; n++) {
        const old = kept.get(n);
        if (old === undefined) continue;
        if (!Outline.verbatim(handed[old], written[n])) {
            draft.rewrite(at, written[n]);
            rewritten.push({ row: session.mark(at), was: handed[old], now: written[n] });
        }
        at++;
    }

    // The new lines, from the top: every line above the one put is in
    // place by then, so its line in the lines as written is its line in
    // the draft, and so is the line it goes under.
    for (let n = line + 1; n <= last;) {
        if (kept.has(n)) { n++; continue; }
        let stop = n;
        while (stop + 1 <= last && !kept.has(stop + 1)) stop++;
        for (const block of blocksOf(after, n, stop + 1)) {
            draft.put({ at: block.at, parent: block.parent, indent: Outline.indentOf(written[block.at]) }, block.lines);
        }
        n = stop + 1;
    }
    return rewritten;
}

/**
 * Which child lines of the row at `line` a replacement keeps: by the line of
 * the lines as written (`after`) each is, the line of the lines before
 * (`before`) it was. `was` is what the draft says each child line was, by
 * its offset from the row, or null.
 *
 * A line is kept only where it stands as it stood, which is what the write's
 * check holds a kept line to (`checkWrite`), asked before anything is
 * written. Each of these makes it a new line instead:
 *
 * - its kind changes (`kindOf`): a line of text that became code, an item
 *   that became a paragraph's text
 * - an item stands under another item than it did: the one it stood under
 *   was not kept, or it went under another. So the items above it are the
 *   ones they were, which is what the check asks of an item it reads a
 *   meaning from
 * - a line that opens no item stands in another item than it did
 *   (`ownerOf`): a new item took it in, which the check refuses
 *   (`disturbs`), or it went on another item's text
 * - it stands above a line kept before it: kept lines are never moved, so
 *   they keep their order
 *
 * The lines are asked from the top, so the item a line stands under is
 * answered before the line is.
 */
export function keptLines(
    before: OutlineReading,
    after: OutlineReading,
    line: number,
    end: number,
    was: readonly (number | null)[],
): Map<number, number> {
    const kept = new Map<number, number>();
    const last = line + was.length;
    // The line before of the line after `n`: the lines outside the subtree
    // and the row are where they were; a new line was none (-1).
    const oldOf = (n: number | null): number | null => {
        if (n === null || n <= line) return n;
        if (n > last) return n - last - 1 + end;
        return kept.get(n) ?? -1;
    };
    let lowest = line;
    was.forEach((offset, i) => {
        if (offset === null) return;
        const old = line + offset;
        const now = line + 1 + i;
        if (old <= lowest) return;
        if (before.kindOf(old) !== after.kindOf(now)) return;
        const item = before.item(old);
        const itemNow = after.item(now);
        if ((item === null) !== (itemNow === null)) return;
        if (item !== null) {
            if (oldOf(itemNow!.parent) !== item.parent) return;
        } else if (oldOf(after.ownerOf(now)) !== before.ownerOf(old)) {
            return;
        }
        kept.set(now, old);
        lowest = old;
    });
    return kept;
}

/**
 * The fence that never closes and runs past the subtree's last line, `last`,
 * as `checkWrite` names one (`WriteFinding.fence`): by its line before the
 * write, when its opening line is one the write keeps (the row's, or one
 * above it); null when there is none, or the draft opened it.
 */
function fenceTakingIn(after: OutlineReading, line: number, last: number, kept: ReadonlyMap<number, number>): number | null {
    const open = after.fences.find(fence => fence.close === null && fence.line <= last && last + 1 < fence.end);
    if (open === undefined) return null;
    if (open.line <= line) return open.line;
    return kept.get(open.line) ?? null;
}

/**
 * The new lines `from` to `to` of `after` as blocks to put (`LineDraft.put`),
 * each to read as it reads there: of its kind, and an item under the line it
 * stands under. A block's first line stands under the spot's parent, the item
 * it goes under (the one its text goes on, for a line that opens none); every
 * other item in it under a line of the block or that same parent. An item
 * under any other line starts a block of its own, since a block can say no
 * more than that (`PlacedReading.under`).
 */
function blocksOf(after: OutlineReading, from: number, to: number): Array<{ at: number; parent: number | null; lines: PlacedLine[] }> {
    const blocks: Array<{ at: number; parent: number | null; lines: PlacedLine[] }> = [];
    let start = from;
    while (start < to) {
        const head = after.item(start);
        const parent = head ? head.parent : after.ownerOf(start);
        const lines: PlacedLine[] = [];
        let n = start;
        for (; n < to; n++) {
            const item = after.item(n);
            let under: PlacedLine['under'];
            if (item !== null) {
                if (n === start || item.parent === parent) under = 'spot';
                else if (item.parent !== null && item.parent >= start && item.parent < n) under = item.parent - start;
                else break;
            }
            lines.push({ text: after.lines[n], kind: after.kindOf(n), ...(under === undefined ? {} : { under }) });
        }
        blocks.push({ at: start, parent, lines });
        start = n;
    }
    return blocks;
}
