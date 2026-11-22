import type { DisplayTask, TimelineOverlapMode } from '../../types';
import { minutesOfSpan } from '../../utils/DayWindow';
import { chooseBandDirections } from './BandDirections';
import {
    bandRangePx,
    cardRange,
    meetByPx,
    namesMeet,
    overlaps,
    type BandDirection,
    type CardRange,
    type PxRange,
} from './CardRanges';
import { SIDE_BY_SIDE_GAP_PX } from './TimedCardGeometry';

/**
 * Where a timed card sits in its day's lane: its width and left offset, in
 * percent of the lane, its rank, the place it stands in front of the day's
 * other cards (1 is the back, the number of cards the front), whether it
 * lies over another card it overlaps in time, which it then traces in the
 * background colour, and, for a card too low to show its name inside, the
 * way its name band hangs (`band`, absent for a card with no band).
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
 * - `bandHaloBlockPx`: how far the halo traced round a name band reaches
 *   past the band's foot.
 * - `narrowestSideBySidePx`: the narrowest a card put side by side may be.
 *   `null` never puts cards side by side; 0 puts them side by side whatever
 *   the lane's width, short of a column narrower than nothing; a positive
 *   number puts a group side by side only where each of its columns is at
 *   least that wide.
 */
export interface TimelineLane {
    pxPerMinute: number;
    widthPx: number;
    bandInsetPx: number;
    bandHaloBlockPx: number;
    narrowestSideBySidePx: number | null;
}

/**
 * The narrowest a card put side by side may be, for a way of laying out
 * cards that would hide each other's names (`TimelineLane.narrowestSideBySidePx`):
 * never for `cascade`, `thresholdPx` for `auto`, any width for `sideBySide`.
 */
export function narrowestSideBySidePx(mode: TimelineOverlapMode, thresholdPx: number): number | null {
    switch (mode) {
        case 'cascade': return null;
        case 'auto': return thresholdPx;
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

/** Cards that take one level together: one card, or a group put side by side. */
interface Unit {
    members: Item[];
    start: number;
    end: number;
}

/** Where a card ended up: its slot in percent of the lane and its level. */
interface Placed {
    item: Item;
    width: number;
    left: number;
    level: number;
}

/** Start order, the longer first on a tie, so a shorter card sits on top. */
function byStart(a: { start: number; end: number }, b: { start: number; end: number }): number {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
}

/** Whether two cards' times overlap, each starting before the other ends. */
function timesOverlap(a: Item, b: Item): boolean {
    return a.start < b.end && b.start < a.end;
}

// Every card of a cluster has one width, f(max level), and is shifted right
// by a step per level, so a card behind shows at least a step at its left.
//   max level 3:  level 1 0..70,  level 2 15..85,  level 3 30..100
// A width that would go under MIN_WIDTH stays at it, and the step shrinks so
// the deepest card still ends at 100.
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
     * a cluster, which a group put side by side, the levels, the columns of
     * a group and what stops a group's right edge. Two cards overlap where
     * their times do or where one's band hides the other's name, so a band
     * that would hide a name it does not overlap in time moves that card
     * right as a card overlapping it in time does.
     */
    static calculateTaskLayout(
        tasks: DisplayTask[],
        startHour: number,
        lane: TimelineLane,
    ): Map<string, LaneSlot> {
        const layout = new Map<string, LaneSlot>();
        if (tasks.length === 0) return layout;

        const halo = lane.bandHaloBlockPx;
        // What each task is drawn over, in minutes of its visual day. In
        // start order, the ID settling cards of one start and one length,
        // so the layout does not follow the order the cards come in.
        const prepared = tasks.filter(task => task.drawn).map(task => {
            const { start, end } = minutesOfSpan(task.drawn!, startHour);
            return { task, start, end, range: cardRange(start, end, lane.pxPerMinute) };
        }).sort((a, b) => byStart(a, b) || (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0));
        const directions = chooseBandDirections(prepared.map(p => p.range), halo);
        const items: Item[] = prepared.map(p => ({ ...p, band: directions.get(p.range) ?? 'down' }));
        const overlap = (a: Item, b: Item): boolean => overlaps(a.range, a.band, b.range, b.band, halo);

        const placed: Placed[] = [];
        const usablePx = lane.widthPx;
        const minWidthPx = lane.narrowestSideBySidePx;
        const sideBySideOn = minWidthPx !== null && usablePx > 0;

        for (const cluster of clustersOf(items, overlap)) {
            // A group is put side by side only if each of its columns is at
            // least the narrowest a card may be. A group that is not is laid
            // out as its cards one by one, which can narrow the columns of
            // the others, so the groups left are checked again until all
            // fit. A group is wholly side by side or not at all.
            let groups = sideBySideOn ? nameCollisionGroups(cluster, overlap) : [];
            let result = placeCluster(cluster, groups, usablePx, overlap);
            for (;;) {
                const fitting = groups.filter((_, i) => result.columnWidthPx[i] >= minWidthPx!);
                if (fitting.length === groups.length) break;
                groups = fitting;
                result = placeCluster(cluster, groups, usablePx, overlap);
            }
            for (const item of cluster) placed.push({ item, ...result.slots.get(item)! });
        }

        // A band's reach across the lane, and a card's, in px; in a lane of
        // no width the percentages are taken as px and the band has no notch.
        const scale = usablePx > 0 ? usablePx / 100 : 1;
        const bandInset = usablePx > 0 ? lane.bandInsetPx : 0;
        const across = (p: Placed): PxRange => [p.left * scale, (p.left + p.width) * scale];
        const bandAcross = (p: Placed): PxRange => [p.left * scale + bandInset, (p.left + p.width) * scale];

        // A card's body, and a short card's band, as boxes in px.
        const bodyOf = (p: Placed): Box => ({
            across: across(p),
            down: [p.item.range.topPx, p.item.range.topPx + p.item.range.heightPx],
        });
        const bandOf = (p: Placed): Box => ({ across: bandAcross(p), down: bandRangePx(p.item.range, p.item.band) });
        const boxesOf = (p: Placed): Box[] => p.item.range.short ? [bodyOf(p), bandOf(p)] : [bodyOf(p)];

        const front = frontToBack(placed, across, bandAcross);
        front.forEach((p, i) => {
            const behind = front.slice(i + 1).flatMap(boxesOf);
            layout.set(p.item.task.id, {
                width: p.width,
                left: p.left,
                rank: front.length - i,
                liesOver: p.level > 1,
                rightLiesOver: rightEdgeOver(bodyOf(p), behind),
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

/**
 * Whether the right edge of `box` lies over one of `behind`: shares 1px or
 * more with it down the lane and across, and it reaches 1px or more right
 * of the edge.
 */
function rightEdgeOver(box: Box, behind: Box[]): boolean {
    return behind.some(b => meetByPx(box.down, b.down)
        && meetByPx(box.across, b.across)
        && b.across[1] - box.across[1] >= 1);
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

/**
 * The groups of a cluster's cards (in start order) whose names would hide
 * each other: two cards that overlap and whose names lie at one height.
 * Cards joined through such pairs are one group (A and B a pair, B and C a
 * pair: A, B and C), even if two of them are not a pair. Two longer cards
 * that do not overlap in time are never a pair: the earlier stands in front
 * of the later, so its name is not hidden.
 */
function nameCollisionGroups(cluster: Item[], overlap: (a: Item, b: Item) => boolean): Item[][] {
    return joined(cluster, (i, j) => {
        const a = cluster[i];
        const b = cluster[j];
        return overlap(a, b) && namesMeet(a.range, a.band, b.range, b.band);
    }).filter(group => group.length > 1);
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
 * Puts each of a group's cards (in start order) in the first column holding
 * no card it overlaps, opening a new column when every one does. Two short
 * cards one after the other whose bands clash do not share a column, though
 * their times do not overlap.
 */
function firstFreeColumns(members: Item[], overlap: (a: Item, b: Item) => boolean): { columns: number[]; columnCount: number } {
    const held: Item[][] = [];
    const columns = members.map(member => {
        let column = held.findIndex(cards => !cards.some(card => overlap(card, member)));
        if (column === -1) {
            column = held.length;
            held.push([]);
        }
        held[column].push(member);
        return column;
    });
    return { columns, columnCount: Math.max(1, held.length) };
}

/**
 * Lays out one cluster (in start order) with each group taking one level as
 * one card from its first start to its last end, and splits the span from
 * the left of the group's level to the group's right edge into its columns.
 * Gives each card's slot and level, and each group's column width in px (in
 * the order of `groups`).
 */
function placeCluster(
    cluster: Item[],
    groups: Item[][],
    usablePx: number,
    overlap: (a: Item, b: Item) => boolean,
): {
    slots: Map<Item, { width: number; left: number; level: number }>;
    columnWidthPx: number[];
} {
    const inGroup = new Set(groups.flat());
    const units: Unit[] = [
        ...groups.map(members => ({
            members,
            start: members[0].start,
            end: Math.max(...members.map(m => m.end)),
        })),
        ...cluster.filter(item => !inGroup.has(item)).map(item => ({
            members: [item],
            start: item.start,
            end: item.end,
        })),
    ].sort(byStart);

    // A unit's level is one more than the highest level of the units before
    // it that it overlaps: their spans overlap in time, or a card of one
    // overlaps a card of the other.
    const unitsOverlap = (a: Unit, b: Unit): boolean =>
        (a.start < b.end && a.end > b.start) || a.members.some(m => b.members.some(o => overlap(m, o)));
    const levels = new Map<Unit, number>();
    for (let i = 0; i < units.length; i++) {
        let below = 0;
        for (let j = 0; j < i; j++) {
            if (unitsOverlap(units[i], units[j])) below = Math.max(below, levels.get(units[j])!);
        }
        levels.set(units[i], below + 1);
    }

    const maxLevel = Math.max(1, ...levels.values());
    const width = Math.max(MIN_WIDTH, 100 - (maxLevel - 1) * CASCADE_STEP);
    const step = maxLevel > 1 ? (100 - width) / (maxLevel - 1) : 0;
    const gap = usablePx > 0 ? SIDE_BY_SIDE_GAP_PX / usablePx * 100 : 0;

    const columnsOf = new Map<Unit, { columns: number[]; columnCount: number }>();
    for (const unit of units) {
        if (unit.members.length > 1) columnsOf.set(unit, firstFreeColumns(unit.members, overlap));
    }

    // A group reaches right of its level's slot, as far as its columns
    // would reach were each shifted a level on from the one before, and no
    // further than the lane's edge. A unit of a higher level that overlaps
    // a card of the group's last column stops it a step short of its own
    // right edge, so the card at the group's right and a card in front
    // overlapping it do not end at one place.
    // That unit lies further right than the group's own slot by a step at
    // least, so the group is never narrower than its slot. A group's right
    // edge depends on those of the groups above it, so the highest level
    // goes first.
    const rightOf = new Map<Unit, number>();
    const rightEdge = (unit: Unit): number =>
        rightOf.get(unit) ?? (levels.get(unit)! - 1) * step + width;
    const groupUnits = units.filter(unit => unit.members.length > 1)
        .sort((a, b) => levels.get(b)! - levels.get(a)!);
    for (const unit of groupUnits) {
        const level = levels.get(unit)!;
        const { columns, columnCount } = columnsOf.get(unit)!;
        const lastColumn = unit.members.filter((_, i) => columns[i] === columnCount - 1);
        let right = Math.min((level + columnCount - 2) * step + width, 100);
        for (const other of units) {
            if (levels.get(other)! <= level) continue;
            if (!lastColumn.some(m => other.members.some(o => overlap(m, o)))) continue;
            right = Math.min(right, rightEdge(other) - step);
        }
        rightOf.set(unit, right);
    }

    const slots = new Map<Item, { width: number; left: number; level: number }>();
    const columnWidthPx = new Array<number>(groups.length).fill(0);
    for (const unit of units) {
        const level = levels.get(unit)!;
        const left = (level - 1) * step;
        if (unit.members.length === 1) {
            slots.set(unit.members[0], { width, left, level });
            continue;
        }
        const { columns, columnCount } = columnsOf.get(unit)!;
        const slotPx = (rightOf.get(unit)! - left) / 100 * usablePx;
        const columnPx = (slotPx - (columnCount - 1) * SIDE_BY_SIDE_GAP_PX) / columnCount;
        const columnWidth = columnPx / usablePx * 100;
        unit.members.forEach((member, i) => {
            slots.set(member, { width: columnWidth, left: left + columns[i] * (columnWidth + gap), level });
        });
        columnWidthPx[groups.indexOf(unit.members)] = columnPx;
    }
    return { slots, columnWidthPx };
}

/**
 * The day's cards from the front to the back. A card in front of another
 * traces the part of its outline over the other in the view's background
 * colour.
 *
 * Two relations say one card must stand in front of another:
 *   - Two cards whose times overlap have different levels, and the one
 *     shifted right (the higher level) stands in front. Cards put side by
 *     side share a level and lie over none of each other.
 *   - A short card whose time does not overlap another's stands in front of
 *     it where its band lies over it: over its body, or over its band if it
 *     is short too, by 1px or more down the lane, and right of the band's
 *     notch by 1px or more across it. So a band going down lies over the
 *     card after it, and a band going up over the card before it. Across
 *     as well as down, or two short cards put side by side, each band
 *     beside the other's, would each have to stand in front of the other.
 * Of the cards no card left must stand in front of, the one starting
 * first goes next, then the one ending first, then the lower ID. Where the
 * relations go round and every card left must stand in front of another,
 * `nextWhereRelationsGoRound` picks the next.
 */
function frontToBack(
    placed: Placed[],
    across: (p: Placed) => PxRange,
    bandAcross: (p: Placed) => PxRange,
): Placed[] {
    const meet = (a: PxRange, b: PxRange) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) >= 1;
    const down = (p: Placed): PxRange => p.item.range.short
        ? bandRangePx(p.item.range, p.item.band)
        : [p.item.range.topPx, p.item.range.topPx + p.item.range.heightPx];
    const byLevel = (a: Placed, b: Placed) => timesOverlap(a.item, b.item) && a.level > b.level;
    const byBand = (a: Placed, b: Placed) => a.item.range.short
        && !timesOverlap(a.item, b.item)
        && meet(bandRangePx(a.item.range, a.item.band), down(b))
        && meet(bandAcross(a), across(b));
    const mustFront = (a: Placed, b: Placed) => a !== b && (byLevel(a, b) || byBand(a, b));

    const left = placed.slice();
    const order: Placed[] = [];
    while (left.length > 0) {
        const free = left.filter(c => !left.some(d => mustFront(d, c)));
        const next = free.length > 0
            ? free.sort(firstInFront)[0]
            : nextWhereRelationsGoRound(left, byLevel);
        order.push(next);
        left.splice(left.indexOf(next), 1);
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
 * For now, the next card where the relations of `frontToBack` go round:
 * that step keeps only the levels of cards whose times overlap, and puts
 * the highest level next, as cards shifted right are, then as
 * `firstInFront`. Two cards whose times overlap never go round, a higher
 * level being higher, so some card is always free of them.
 */
function nextWhereRelationsGoRound(left: Placed[], byLevel: (a: Placed, b: Placed) => boolean): Placed {
    const free = left.filter(c => !left.some(d => d !== c && byLevel(d, c)));
    return free.sort((a, b) => b.level - a.level || firstInFront(a, b))[0];
}
