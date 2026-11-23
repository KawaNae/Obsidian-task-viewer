import type { DisplayTask, TimelineOverlapMode } from '../../types';
import { minutesOfSpan } from '../../utils/DayWindow';
import { chooseBandDirections } from './BandDirections';
import {
    bandRangePx,
    bodyRangePx,
    byStart,
    cardRange,
    meetByPx,
    overlaps,
    timesOverlap,
    type BandDirection,
    type CardRange,
    type PxRange,
} from './CardRanges';
import { laneHeightPx } from './TimedCardGeometry';

/**
 * Where a timed card sits in its day's lane: its width and left offset, in
 * percent of the lane, its rank, the place it stands in front of the day's
 * other cards (1 is the back, the number of cards the front), whether it
 * lies over a card behind it, which it then traces in the background
 * colour, and, for a card too low to show its name inside, the way its
 * name band hangs (`band`, absent for a card with no band).
 *
 * `liesOver` is whether a card behind comes into the room the halo takes
 * round the card's body: the body widened left by the halo's reach across
 * and up and down by its reach down the lane shares 1px or more with the
 * body or the band of a card behind, down the lane and across. A card's
 * body is drawn 3px shorter than its time, as far as the halo reaches down
 * the lane, so two cards one after the other stand that far apart, and
 * two put side by side stand as far apart as it reaches across. A card
 * behind comes into the room only where it lies nearer than that: where
 * their times overlap, where a card drawn at its least height reaches
 * past its end, or where a band lies there. A card with nothing behind it
 * there gets no halo, whatever its level.
 *
 * `rightLiesOver` is whether the right edge of the card's body lies over a
 * card behind it, and `bandRightLiesOver` the same for its band's right
 * edge (absent for a card with no band): of a card behind it, the body or
 * the band shares 1px or more with it down the lane and across, and
 * reaches 1px or more right of its right edge. Such an edge is part of the
 * outline traced over the card behind. An edge with nothing behind it, or
 * one that ends where the card behind ends, gets no trace.
 *
 * `bandGap` is, in minutes, how long after the start of the nearest short
 * card whose band hangs down over this card's top this card starts: of the
 * short cards in front of it whose band goes down, that end by its start
 * and whose band, with its halo, lies over it from side to side, the one
 * that starts last. The band hangs a fixed height from that card's top,
 * so CSS turns the gap into how much of this card's top the band covers.
 * Which cards are short and which way their bands go follow the zoom, so
 * the gap is laid out again with the zoom; in minutes, CSS keeps it right
 * while a pinch goes on, until the cards are placed again. Absent when no
 * band hangs over the card's top.
 */
export interface LaneSlot {
    width: number;
    left: number;
    rank: number;
    liesOver: boolean;
    rightLiesOver: boolean;
    bandRightLiesOver?: boolean;
    bandGap?: number;
    band?: BandDirection;
}

/**
 * The lane the cards are laid out in, read once a draw or once a placing
 * again, so the layout follows the zoom, the lane's width and the view's
 * way of laying out as they are then.
 *
 * - `pxPerMinute`: the lane's scale, which decides each card's height and
 *   so whether it shows its name in a band, and which way the band goes.
 * - `widthPx`: what the cards' percentages are of; 0 while the lane has no
 *   width (not laid out), when a band is taken to lie over the card's whole
 *   width and no cards are put side by side.
 * - `bandInsetPx`: how far in from a card's left edge its name band's halo
 *   starts; the band reaches the card's right edge. A band covers only the
 *   cards it lies over right of that, not those under its notch.
 * - `haloBlockPx`: how far the halo traced round a card in front, or round
 *   its name band, reaches past its top or bottom edge.
 * - `haloInlinePx`: how far the halo traced round a card in front reaches
 *   past its left or right edge. Cards put side by side stand this far
 *   apart, so the halo of one reaches the edge of the card beside it and
 *   cuts no strip off it.
 * - `narrowestSideBySidePx`: the narrowest a column of a cluster put side
 *   by side may be. `null` never puts a cluster side by side; 0 puts every
 *   cluster of two cards or more side by side, whatever the lane's width;
 *   a positive number puts a cluster side by side only where each of its
 *   columns is at least that wide, and shifts the others right level by
 *   level.
 */
export interface TimelineLane {
    pxPerMinute: number;
    widthPx: number;
    bandInsetPx: number;
    haloBlockPx: number;
    haloInlinePx: number;
    narrowestSideBySidePx: number | null;
}

/**
 * The narrowest a column of a cluster put side by side may be, for a way of
 * laying out cards (`TimelineLane.narrowestSideBySidePx`): never side by
 * side for `cascade`, any width for `sideBySide`, and for `auto` the
 * narrowest a card shows its start and end time whole and has a box for its
 * name as wide as those times (`legibleCardPx`), so a card put side by side
 * never has its times cut nor its name wrapped narrower than them. Under `auto` a width of 0
 * or less, which was not measured, puts no cluster side by side: as 0 it
 * would put every cluster side by side however narrow, as `sideBySide`.
 */
export function narrowestSideBySidePx(mode: TimelineOverlapMode, legibleCardPx: number): number | null {
    switch (mode) {
        case 'cascade': return null;
        case 'auto': return legibleCardPx > 0 ? legibleCardPx : null;
        case 'sideBySide': return 0;
    }
}

/** A card with its range down the lane and the way its band goes, `down` for a card with no band. */
interface Item {
    task: DisplayTask;
    start: number;
    end: number;
    range: CardRange;
    band: BandDirection;
}

/** A card's slot in percent of the lane, and its level. */
interface Slot {
    width: number;
    left: number;
    level: number;
}

/** A card with the slot it ended up in. */
interface Placed extends Slot {
    item: Item;
}

// In a cluster shifted right, a level's slot has one width, f(max level),
// and is shifted right by a step per level; each card fills its level's slot.
//   max level 3:  level 1 0..70,  level 2 15..85,  level 3 30..100
// A width that would go under MIN_WIDTH stays at it, and the step shrinks so
// the deepest slot still ends at 100.
const CASCADE_STEP = 15;
const MIN_WIDTH = 40;

export class TaskLayout {
    /**
     * Lays out a day's timed cards in `lane` (`TimelineLane`).
     *
     * Each card has a range down the lane at the lane's scale, and each
     * short card's band goes the way that hides the fewest names
     * (`chooseBandDirections`). From then on one relation, `overlaps`,
     * decides everything that is laid out by overlapping: which cards form
     * a cluster, and in a cluster the columns or the levels. Two cards
     * overlap where their times do or where one's band hides the other's
     * name, so a band that would hide a name it does not overlap in time
     * keeps that card apart as a card overlapping it in time does.
     *
     * Each cluster is laid out in one of two ways, never both: side by side
     * where its columns are wide enough (`sideBySide`), so no card hides
     * another's name, else shifted right level by level (`shiftedRight`),
     * which takes less room but lets a card in front cover the names of
     * those behind it.
     */
    static calculateTaskLayout(
        tasks: DisplayTask[],
        startHour: number,
        lane: TimelineLane,
    ): Map<string, LaneSlot> {
        const layout = new Map<string, LaneSlot>();
        if (tasks.length === 0) return layout;

        const halo = lane.haloBlockPx;
        // What each task is drawn over, in minutes of its visual day. In
        // start order, the ID settling cards of one start and one length,
        // so the layout does not follow the order the cards come in.
        const prepared = tasks.filter(task => task.drawn).map(task => {
            const { start, end } = minutesOfSpan(task.drawn!, startHour);
            return { task, start, end, range: cardRange(start, end, lane.pxPerMinute) };
        }).sort((a, b) => byStart(a, b) || (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0));
        const directions = chooseBandDirections(prepared.map(p => p.range), halo, laneHeightPx(lane.pxPerMinute));
        const items: Item[] = prepared.map(p => ({ ...p, band: directions.get(p.range) ?? 'down' }));
        const overlap = (a: Item, b: Item): boolean => overlaps(a.range, a.band, b.range, b.band, halo);

        const placed: Placed[] = [];
        const usablePx = lane.widthPx;
        const minWidthPx = lane.narrowestSideBySidePx;
        const sideBySideOn = minWidthPx !== null && usablePx > 0;

        for (const cluster of clustersOf(items, overlap)) {
            const slots = (sideBySideOn && cluster.length > 1
                ? sideBySide(cluster, usablePx, lane.haloInlinePx, minWidthPx, overlap)
                : null) ?? shiftedRight(cluster, overlap);
            for (const item of cluster) placed.push({ item, ...slots.get(item)! });
        }

        // A band's reach across the lane, and a card's, in px; in a lane of
        // no width the percentages are taken as px, and the band has no
        // notch and the halo no reach across.
        const scale = usablePx > 0 ? usablePx / 100 : 1;
        const bandInset = usablePx > 0 ? lane.bandInsetPx : 0;
        const haloAcross = usablePx > 0 ? lane.haloInlinePx : 0;
        const across = (p: Placed): PxRange => [p.left * scale, (p.left + p.width) * scale];
        const bandAcross = (p: Placed): PxRange => [p.left * scale + bandInset, (p.left + p.width) * scale];

        // A card's body, and a short card's band, as boxes in px.
        const bodyOf = (p: Placed): Box => ({ across: across(p), down: bodyRangePx(p.item.range) });
        const bandOf = (p: Placed): Box => ({ across: bandAcross(p), down: bandRangePx(p.item.range, p.item.band) });
        const boxesOf = (p: Placed): Box[] => p.item.range.short ? [bodyOf(p), bandOf(p)] : [bodyOf(p)];
        // The body with the room its halo takes: past its left edge, its top
        // and its bottom, not its right, which is traced only where it lies
        // over a card behind.
        const haloRoomOf = (body: Box): Box => ({
            across: [body.across[0] - haloAcross, body.across[1]],
            down: [body.down[0] - halo, body.down[1] + halo],
        });

        const front = frontToBack(placed, across, bandAcross);
        front.forEach((p, i) => {
            const behind = front.slice(i + 1).flatMap(boxesOf);
            const body = bodyOf(p);
            layout.set(p.item.task.id, {
                width: p.width,
                left: p.left,
                rank: front.length - i,
                liesOver: boxesMet(haloRoomOf(body), behind).length > 0,
                rightLiesOver: rightEdgeOver(body, behind),
                ...(p.item.range.short ? { band: p.item.band, bandRightLiesOver: rightEdgeOver(bandOf(p), behind) } : {}),
            });
        });

        // The gap to the band that hangs over each card's top, taken from
        // the places the cards end up in, side by side or not. Only a short
        // card whose band goes down hangs it over a card after it: a band
        // going up lies over the cards before, and a longer card has no
        // band. The band must stand in front and end by the card's start:
        // a card in front whose time overlaps it covers it with its body,
        // if at all. Of those, the one starting last lies lowest over its
        // top. The same level is not enough to find it: a card shifted
        // right in one cluster lies over the first card of the next.
        for (const n of placed) {
            const below = layout.get(n.item.task.id)!;
            const [belowLeft, belowRight] = across(n);
            let gap: number | undefined;
            for (const p of placed) {
                if (!p.item.range.short || p.item.band !== 'down') continue;
                if (layout.get(p.item.task.id)!.rank <= below.rank || p.item.end > n.item.start) continue;
                const [bandStart, bandEnd] = bandAcross(p);
                if (bandStart >= belowRight || bandEnd <= belowLeft) continue;
                const g = n.item.start - p.item.start;
                if (gap === undefined || g < gap) gap = g;
            }
            if (gap !== undefined) below.bandGap = gap;
        }

        return layout;
    }
}

/** A part of a card in px: across the lane, and down it. */
interface Box {
    across: PxRange;
    down: PxRange;
}

/** The boxes of `behind` that `box` shares 1px or more with, down the lane and across. */
function boxesMet(box: Box, behind: Box[]): Box[] {
    return behind.filter(b => meetByPx(box.down, b.down) && meetByPx(box.across, b.across));
}

/**
 * Whether the right edge of `box` lies over one of `behind`: of the boxes
 * it meets (`boxesMet`), one reaches 1px or more right of the edge.
 */
function rightEdgeOver(box: Box, behind: Box[]): boolean {
    return boxesMet(box, behind).some(b => b.across[1] - box.across[1] >= 1);
}

/**
 * The day's cards joined through pairs that overlap, each cluster in start
 * order. A band's reach does not follow the cards' start order, so every
 * pair is compared rather than the cards swept once by their ends.
 */
function clustersOf(items: Item[], overlap: (a: Item, b: Item) => boolean): Item[][] {
    const sorted = items.slice().sort(byStart);
    return joined(sorted, (i, j) => overlap(sorted[i], sorted[j]));
}

/** `items` split into the sets joined by the pairs `pair(i, j)` (i < j) holds for, each in the order of `items`. */
function joined<T>(items: T[], pair: (i: number, j: number) => boolean): T[][] {
    const parent = items.map((_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            if (pair(i, j)) parent[find(j)] = find(i);
        }
    }
    const byRoot = new Map<number, T[]>();
    items.forEach((item, i) => {
        const root = find(i);
        const set = byRoot.get(root);
        if (set) set.push(item);
        else byRoot.set(root, [item]);
    });
    return [...byRoot.values()];
}

/**
 * Puts each of a cluster's cards (in start order) in the first column
 * holding no card it overlaps, opening a new column when every one does.
 * Two short cards one after the other whose bands clash do not share a
 * column, though their times do not overlap. Gives each card's column and
 * the cards of each column.
 */
function firstFreeColumns(cluster: Item[], overlap: (a: Item, b: Item) => boolean): { columns: number[]; held: Item[][] } {
    const held: Item[][] = [];
    const columns = cluster.map(card => {
        let column = held.findIndex(cards => !cards.some(other => overlap(other, card)));
        if (column === -1) {
            column = held.length;
            held.push([]);
        }
        held[column].push(card);
        return column;
    });
    return { columns, held };
}

/**
 * Lays out a cluster of two cards or more (in start order) side by side:
 * its columns (`firstFreeColumns`) split the lane, `gapPx` apart, and each
 * card starts at its own column and reaches right over the columns after
 * it up to the first that holds a card it overlaps. So no two cards that
 * overlap lie over each other across the lane.
 *
 *   a 08:00-17:00, b 09:00-10:00, c 09:00-10:00, d 11:00-12:00
 *   columns a | b | c, and d in b's column reaching over c's: a 0..1/3,
 *   b 1/3..2/3, c 2/3..1, d 1/3..1
 *
 * A card's level is its column's number from 1, so of two cards whose
 * times overlap the one further right stands in front, as in a cluster
 * shifted right; the two lie over none of each other, so this only orders
 * them.
 *
 * Gives null where a column would be narrower than `minWidthPx`.
 */
function sideBySide(
    cluster: Item[],
    usablePx: number,
    gapPx: number,
    minWidthPx: number,
    overlap: (a: Item, b: Item) => boolean,
): Map<Item, Slot> | null {
    const { columns, held } = firstFreeColumns(cluster, overlap);
    const n = held.length;
    const gap = gapPx / usablePx * 100;
    const columnWidth = (100 - (n - 1) * gap) / n;
    if (columnWidth / 100 * usablePx < minWidthPx) return null;
    const slots = new Map<Item, Slot>();
    cluster.forEach((card, i) => {
        const k = columns[i];
        let span = 1;
        while (k + span < n && !held[k + span].some(other => overlap(other, card))) span++;
        slots.set(card, {
            width: span * columnWidth + (span - 1) * gap,
            left: k * (columnWidth + gap),
            level: k + 1,
        });
    });
    return slots;
}

/**
 * Lays out a cluster (in start order) shifted right level by level: a
 * card's level is one more than the highest level of the cards before it
 * that it overlaps, and it fills its level's slot.
 */
function shiftedRight(cluster: Item[], overlap: (a: Item, b: Item) => boolean): Map<Item, Slot> {
    const levels: number[] = [];
    cluster.forEach((card, i) => {
        let below = 0;
        for (let j = 0; j < i; j++) {
            if (overlap(card, cluster[j])) below = Math.max(below, levels[j]);
        }
        levels.push(below + 1);
    });
    const maxLevel = Math.max(1, ...levels);
    const width = Math.max(MIN_WIDTH, 100 - (maxLevel - 1) * CASCADE_STEP);
    const step = maxLevel > 1 ? (100 - width) / (maxLevel - 1) : 0;
    return new Map(cluster.map((card, i) => [card, { width, left: (levels[i] - 1) * step, level: levels[i] }]));
}

/**
 * The day's cards from the front to the back. A card in front of another
 * traces the part of its outline over the other in the view's background
 * colour.
 *
 * Two relations say one card must stand in front of another:
 *   - Two cards whose times overlap have different levels, and the one
 *     shifted right (the higher level) stands in front. In a cluster put
 *     side by side such cards lie over none of each other, the level of
 *     each its column's number, so this only orders them.
 *   - A short card whose time does not overlap another's stands in front of
 *     it where its band lies over it: over its body, or over its band if it
 *     is short too, by 1px or more down the lane, and right of the band's
 *     notch by 1px or more across it. So a band going down lies over the
 *     card after it, and a band going up over the card before it. Across
 *     as well as down, or two short cards put side by side, each band
 *     beside the other's, would each have to stand in front of the other.
 * The relations are worked out once for each pair. Where they go round,
 * the cards on a round cannot all keep them: such cards, each reaching
 * every other through the relations, are taken as one set, and every
 * relation between a set and a card outside it is kept. For now, the
 * cards of one set keep only the first relation, which never goes round,
 * a higher level being higher: they stand from the highest level down,
 * then as `firstInFront`. Of the sets no card left must stand in front of,
 * the one whose front card comes first by `firstInFront` goes next, all
 * its cards together. A card on no round is a set of its own.
 */
function frontToBack(
    placed: Placed[],
    across: (p: Placed) => PxRange,
    bandAcross: (p: Placed) => PxRange,
): Placed[] {
    // What each card shows down the lane that a band may lie over: a short
    // card's band, or a longer card's body. Its reach across, and its band's.
    const downOf = placed.map((p): PxRange => p.item.range.short
        ? bandRangePx(p.item.range, p.item.band)
        : bodyRangePx(p.item.range));
    const acrossOf = placed.map(across);
    const bandAcrossOf = placed.map(bandAcross);

    // `inFrontOf[i]`: the cards card i must stand in front of.
    const inFrontOf = placed.map((a, i) => {
        const fronts: number[] = [];
        placed.forEach((b, j) => {
            if (i === j) return;
            const inFront = timesOverlap(a.item, b.item)
                ? a.level > b.level
                : a.item.range.short && meetByPx(downOf[i], downOf[j]) && meetByPx(bandAcrossOf[i], acrossOf[j]);
            if (inFront) fronts.push(j);
        });
        return fronts;
    });
    const sets = stronglyConnected(inFrontOf);
    const setOf = new Array<number>(placed.length);
    sets.forEach((set, k) => set.forEach(i => { setOf[i] = k; }));
    const cardsOf = sets.map(set => set.map(i => placed[i]).sort((a, b) => b.level - a.level || firstInFront(a, b)));

    // How many relations from cards outside each set, of cards still left.
    const waiting = sets.map(() => 0);
    inFrontOf.forEach((js, i) => js.forEach(j => {
        if (setOf[j] !== setOf[i]) waiting[setOf[j]]++;
    }));
    let free = sets.map((_, k) => k).filter(k => waiting[k] === 0);
    const order: Placed[] = [];
    while (free.length > 0) {
        const next = free.reduce((a, b) => firstInFront(cardsOf[a][0], cardsOf[b][0]) <= 0 ? a : b);
        free = free.filter(k => k !== next);
        order.push(...cardsOf[next]);
        for (const i of sets[next]) {
            for (const j of inFrontOf[i]) {
                if (setOf[j] !== next && --waiting[setOf[j]] === 0) free.push(setOf[j]);
            }
        }
    }
    return order;
}

/** The order of the cards free to go next, front first: the earlier start, then the earlier end, then the lower ID. */
function firstInFront(a: Placed, b: Placed): number {
    if (a.item.start !== b.item.start) return a.item.start - b.item.start;
    if (a.item.end !== b.item.end) return a.item.end - b.item.end;
    const ai = a.item.task.id;
    const bi = b.item.task.id;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/**
 * The nodes `0` to `next.length - 1` split into the sets whose nodes each
 * reach every other through the edges `next[i]` (i to each of them), by
 * Tarjan's algorithm, walked without recursion: each node and edge once.
 */
function stronglyConnected(next: number[][]): number[][] {
    const index = next.map(() => -1);
    const low = next.map(() => 0);
    const onStack = next.map(() => false);
    const stack: number[] = [];
    const sets: number[][] = [];
    let count = 0;
    const visit = (v: number) => {
        index[v] = low[v] = count++;
        stack.push(v);
        onStack[v] = true;
    };
    for (let root = 0; root < next.length; root++) {
        if (index[root] !== -1) continue;
        visit(root);
        // The walk's path, each node with the next of its edges to follow.
        const path: [number, number][] = [[root, 0]];
        while (path.length > 0) {
            const top = path[path.length - 1];
            const v = top[0];
            if (top[1] < next[v].length) {
                const w = next[v][top[1]++];
                if (index[w] === -1) {
                    visit(w);
                    path.push([w, 0]);
                } else if (onStack[w]) {
                    low[v] = Math.min(low[v], index[w]);
                }
                continue;
            }
            path.pop();
            if (path.length > 0) {
                const u = path[path.length - 1][0];
                low[u] = Math.min(low[u], low[v]);
            }
            if (low[v] !== index[v]) continue;
            const set: number[] = [];
            let w: number;
            do {
                w = stack.pop()!;
                onStack[w] = false;
                set.push(w);
            } while (w !== v);
            sets.push(set);
        }
    }
    return sets;
}
