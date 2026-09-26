import { ChildLineClassifier } from './ChildLineClassifier';
import type { LineKind, OutlineReading } from './Outline';

/**
 * Where a line of a write's result came from: a line of the lines the write
 * was handed (`from`, its index there), a line of the `put`th block a write
 * put in (`offset` in it), or a line spliced in without saying where it
 * belongs.
 */
export type WrittenLine =
    | { kind: 'kept'; from: number }
    | { kind: 'placed'; put: number; offset: number }
    | { kind: 'loose' };

/** How a line a write puts in is to read once written. */
export interface PlacedReading {
    kind: LineKind;
    /**
     * For an item, the item it is to stand in: a line of its own block (its
     * offset there), `'spot'` for the parent the block was placed under, or
     * `'lost'` when the line it stood under is not written with it. Asked of
     * an item the plugin reads a meaning from, as of a line the write keeps.
     */
    under?: number | 'spot' | 'lost';
}

/** A block a write put in, as {@link checkWrite} holds it to. */
export interface PutBlock {
    /** The item the block was placed under, as it stood when put; null at the top. */
    parent: WrittenLine | null;
    lines: readonly PlacedReading[];
}

/**
 * What {@link checkWrite} found of a write: `sound`; `unplaceable`, a line
 * put in does not read as it was put; `disturbs`, a line the write kept reads
 * otherwise; `loose`, a line was spliced into the body without saying how it
 * is to read — a bug in the write, not in the note.
 */
export type WriteCheck = 'sound' | 'unplaceable' | 'disturbs' | 'loose';

/**
 * Whether a write left the note reading as it meant to, asked of the reading
 * before the write and the reading after it (`Outline.read`): the one check
 * every write that adds, takes out or rewrites lines is held to
 * (`processLines`). `written` says, per line after, where it came from.
 *
 * - A line kept keeps its kind (`OutlineReading.kindOf`): a heading stays
 *   one, and a line that was none does not become one. An item kept
 *   that the plugin reads a meaning from (`ChildLineClassifier.carriesMeaning`:
 *   a task, a `==>` line, a property, a wikilink child) keeps the items it
 *   stands in: the line it stood under is not taken out, and the items above
 *   it are the ones they were, the lines taken out aside. Else `disturbs`
 * - A line put in reads as its block says: its kind, and, for an item with a
 *   meaning, the item it stands in. Else `unplaceable`
 * - An item put in takes in no line past its block: a paragraph line that
 *   went on it, an item it made its child. Else `disturbs`
 * - A line spliced in without a block is in the frontmatter. Else `loose`
 *
 * The first two are what a line taken out was held to (the L2 `canTakeOut`)
 * and the two a line put in is: one question, whether the lines written are
 * what the write says they are and every other line is what it was.
 *
 * The third asks of every line an item put in takes in, where the first asks
 * a kept line's parent only when the plugin reads a meaning from it: a line
 * the write puts in is the plugin's own text, so a paragraph line going on it
 * is a note's line read as part of a task, where a line taken out only lets a
 * note's line go on another of the note's own.
 *
 * Where several fail, the answer is the first of `loose`, `unplaceable`,
 * `disturbs`: a bug in the write, then the lines it put in, then the lines it
 * kept.
 */
export function checkWrite(
    before: OutlineReading,
    after: OutlineReading,
    written: readonly WrittenLine[],
    puts: readonly PutBlock[],
): WriteCheck {
    const meaningful = (line: string) => ChildLineClassifier.carriesMeaning(line);
    const same = (a: WrittenLine, b: WrittenLine) => a.kind === b.kind && (
        a.kind === 'kept' ? a.from === (b as typeof a).from
            : a.kind === 'placed' ? a.put === (b as typeof a).put && a.offset === (b as typeof a).offset
                : false);
    const keptAt = new Map<number, number>();
    const blockEnd = new Map<number, number>();
    written.forEach((line, k) => {
        if (line.kind === 'kept') keptAt.set(line.from, k);
        if (line.kind === 'placed') blockEnd.set(line.put, k + 1);
    });
    const lineOf = (ref: WrittenLine) => written.findIndex(line => same(line, ref));

    let found: WriteCheck = 'sound';
    const rank: WriteCheck[] = ['sound', 'disturbs', 'unplaceable', 'loose'];
    const fail = (check: WriteCheck) => { if (rank.indexOf(check) > rank.indexOf(found)) found = check; };

    written.forEach((line, k) => {
        if (line.kind === 'loose') {
            if (after.kindOf(k) !== 'frontmatter') fail('loose');
            return;
        }
        if (line.kind === 'placed') {
            const reads = puts[line.put].lines[line.offset];
            if (after.kindOf(k) !== reads.kind) return fail('unplaceable');
            const item = after.item(k);
            if (item === null) return;
            if (reads.under !== undefined && meaningful(after.lines[k])) {
                const parent = reads.under === 'lost' ? undefined
                    : reads.under === 'spot'
                        ? (puts[line.put].parent === null ? null : lineOf(puts[line.put].parent!))
                        : lineOf({ kind: 'placed', put: line.put, offset: reads.under });
                if (parent === undefined || parent === -1 || item.parent !== parent) return fail('unplaceable');
            }
            if (item.end > blockEnd.get(line.put)!) fail('disturbs');
            return;
        }
        const i = line.from;
        if (before.kindOf(i) !== after.kindOf(k)) return fail('disturbs');
        const item = before.item(i);
        if (item === null || !meaningful(before.lines[i])) return;
        if (item.parent !== null && !keptAt.has(item.parent)) return fail('disturbs');
        const above = before.itemsAbove(i).filter(row => keptAt.has(row));
        const aboveNow = after.itemsAbove(k).map(row => written[row].kind === 'kept' ? (written[row] as { from: number }).from : -1);
        if (above.length !== aboveNow.length || above.some((row, n) => row !== aboveNow[n])) fail('disturbs');
    });
    return found;
}
