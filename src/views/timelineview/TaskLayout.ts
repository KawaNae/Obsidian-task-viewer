import type { DisplayTask, TimelineOverlapMode } from '../../types';
import { minutesOfSpan } from '../../utils/DayWindow';
import { assignFirstFreeColumns, buildOverlapClusters } from '../sharedLogic/OverlapClusters';
import { SIDE_BY_SIDE_GAP_PX, nameRowHeightPx } from './TimedCardGeometry';

/**
 * Where a timed card sits in its day's lane: its width and left offset, in
 * percent of the lane, its rank, the place it stands in front of the day's
 * other cards (1 is the back, the number of cards the front), and whether
 * it lies over another card it overlaps in time, which it then traces in
 * the background colour.
 *
 * `bandGap` is, in minutes, how long after the start of the nearest card
 * whose name band may hang over this card's top this card starts: of the
 * cards in front of it that end by its start and whose band, with its halo,
 * lies over it from side to side, the one that starts last. A short card's
 * band hangs a fixed height from its own top, so CSS turns the gap into how
 * much of this card's top the band covers, at whatever zoom; a card in
 * front with no band yields nothing there. Absent when no card can.
 */
export interface LaneSlot {
    width: number;
    left: number;
    rank: number;
    liesOver: boolean;
    bandGap?: number;
}

/**
 * The lane the cards are laid out in, in px: `width` is what the cards'
 * percentages are of, and `bandInset` how far in from a card's left edge
 * its name band's halo starts; the band reaches the card's right edge. A
 * band covers only the cards it lies over right of that, not those under
 * its notch.
 */
export interface LaneGeometry {
    width: number;
    bandInset: number;
}

/**
 * What the layout needs, besides the lane's width, to put cards side by
 * side where one would hide the name of another: the lane's scale in px a
 * minute, and the narrowest a card may become. `null` never puts cards
 * side by side; 0 puts them side by side whatever the lane's width, short
 * of a column narrower than nothing; a positive number puts a group side
 * by side only where each of its columns is at least that wide.
 */
export interface SideBySideInput {
    pxPerMinute: number;
    minCardWidthPx: number | null;
}

/**
 * The narrowest a card put side by side may be, for a way of laying out
 * cards that would hide each other's names (`SideBySideInput.minCardWidthPx`):
 * never for `cascade`, `thresholdPx` for `auto`, any width for `sideBySide`.
 */
export function narrowestSideBySidePx(mode: TimelineOverlapMode, thresholdPx: number): number | null {
    switch (mode) {
        case 'cascade': return null;
        case 'auto': return thresholdPx;
        case 'sideBySide': return 0;
    }
}

interface Item {
    task: DisplayTask;
    start: number;
    end: number;
}

/** Cards that take one level together: one card, or a group put side by side. */
interface Unit {
    members: Item[];
    start: number;
    end: number;
}

/** Start order, the longer first on a tie, so a shorter card sits on top. */
function byStart(a: { start: number; end: number }, b: { start: number; end: number }): number {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
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
     * `lane` is the lane as drawn. Without it (a lane not laid out yet) a
     * band is taken to lie over the card's whole width, and no cards are
     * put side by side. `sideBySide` puts side by side, in a lane of
     * `lane.width`, the cards where one would hide the name of another.
     */
    static calculateTaskLayout(
        tasks: DisplayTask[],
        startHour: number,
        lane?: LaneGeometry,
        sideBySide?: SideBySideInput,
    ): Map<string, LaneSlot> {
        const layout = new Map<string, LaneSlot>();
        if (tasks.length === 0) return layout;

        // What each task is drawn over, in minutes of its visual day.
        const prepared: Item[] = tasks.filter(task => task.drawn).map(task => ({
            task,
            ...minutesOfSpan(task.drawn!, startHour),
        }));

        const clusters = buildOverlapClusters<Item>(prepared, byStart, item => item.start, item => item.end);

        // Each card's level and span, gathered across clusters for the ranks.
        const placed: { id: string; level: number; start: number; end: number }[] = [];

        const usablePx = lane?.width ?? 0;
        const minWidthPx = sideBySide?.minCardWidthPx ?? null;
        const sideBySideOn = sideBySide !== undefined && minWidthPx !== null && usablePx > 0;

        for (const unsorted of clusters) {
            const cluster = unsorted.slice().sort(byStart);

            // A group is put side by side only if each of its columns is at
            // least the narrowest a card may be. A group that is not is laid
            // out as its cards one by one, which can only narrow the levels
            // of the others, so the groups left are checked again until all
            // fit. A group is wholly side by side or not at all.
            let groups = sideBySideOn ? nameCollisionGroups(cluster, sideBySide!.pxPerMinute) : [];
            let result = placeCluster(cluster, groups, usablePx);
            for (;;) {
                const fitting = groups.filter((_, i) => result.columnWidthPx[i] >= minWidthPx!);
                if (fitting.length === groups.length) break;
                groups = fitting;
                result = placeCluster(cluster, groups, usablePx);
            }

            for (const item of cluster) {
                const slot = result.slots.get(item)!;
                layout.set(item.task.id, {
                    width: slot.width,
                    left: slot.left,
                    rank: 0,
                    liesOver: slot.level > 1,
                });
                placed.push({ id: item.task.id, level: slot.level, start: item.start, end: item.end });
            }
        }

        // Rank the day's cards, back to front. A card in front of another
        // traces the part of its outline over the other in the view's
        // background colour.
        //   - Two cards whose times overlap have different levels, and the
        //     one shifted right (the higher level) stands in front. Cards put
        //     side by side share a level and lie over none of each other.
        //   - Two cards of one level never overlap in time. The earlier one
        //     stands in front, so that a short card's name band, which hangs
        //     below its end, lies over the card after it.
        // Comparing levels first keeps the order total where the two
        // pairwise rules would go round in a circle (Q 20:00-20:10 level 1,
        // P 20:05-21:00 level 2, R 20:10-20:20 level 3: R, P, Q front to
        // back). One level and one start only meet for a card of no length
        // beside a longer one, or for cards side by side; the one ending
        // first stands in front, as an earlier card does, and the ID settles
        // the rest.
        placed.sort((a, b) => {
            if (a.level !== b.level) return a.level - b.level;
            if (a.start !== b.start) return b.start - a.start;
            if (a.end !== b.end) return b.end - a.end;
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        });
        placed.forEach((p, i) => {
            layout.get(p.id)!.rank = i + 1;
        });

        // The gap to the card whose band may hang over each card's top, taken
        // from the places the cards end up in, side by side or not. Only a
        // card in front can lie over it, and only one that ends by its start
        // hangs a band there: a card in front whose time overlaps it (two
        // cards starting together, the shorter shifted right, or two cards
        // side by side) covers it with its body, if at all, not with a band.
        // Of those, the one starting last lies lowest over its top. The same
        // level is not enough to find it: a card shifted right in one cluster
        // lies over the first card of the next, and a card of no length
        // stands in front of a longer one starting with it.
        const scale = lane ? lane.width / 100 : 1;
        const bandInset = lane ? lane.bandInset : 0;
        for (const n of placed) {
            const below = layout.get(n.id)!;
            const belowLeft = below.left * scale;
            const belowRight = (below.left + below.width) * scale;
            let gap: number | undefined;
            for (const p of placed) {
                const front = layout.get(p.id)!;
                if (front.rank <= below.rank || p.end > n.start) continue;
                const bandStart = front.left * scale + bandInset;
                const bandEnd = (front.left + front.width) * scale;
                if (bandStart >= belowRight || bandEnd <= belowLeft) continue;
                const g = n.start - p.start;
                if (gap === undefined || g < gap) gap = g;
            }
            if (gap !== undefined) below.bandGap = gap;
        }

        return layout;
    }
}

/**
 * The groups of a cluster's cards (in start order) whose names a later card
 * would hide: two cards that overlap in time where the later starts above
 * the bottom of the earlier's name row. Cards joined through such pairs are
 * one group (A and B a pair, B and C a pair: A, B and C), even if two of
 * them are not a pair. Cards that do not overlap in time are never a pair: the
 * earlier stands in front of the later, so its name is not hidden.
 */
function nameCollisionGroups(cluster: Item[], pxPerMinute: number): Item[][] {
    const parent = cluster.map((_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };

    for (let i = 0; i < cluster.length; i++) {
        const earlier = cluster[i];
        const nameRow = nameRowHeightPx(earlier.end - earlier.start, pxPerMinute);
        for (let j = i + 1; j < cluster.length; j++) {
            const later = cluster[j];
            if (later.start >= earlier.end) continue;
            if ((later.start - earlier.start) * pxPerMinute >= nameRow) continue;
            parent[find(j)] = find(i);
        }
    }

    const byRoot = new Map<number, Item[]>();
    cluster.forEach((item, i) => {
        const root = find(i);
        const group = byRoot.get(root);
        if (group) group.push(item);
        else byRoot.set(root, [item]);
    });
    return [...byRoot.values()].filter(group => group.length > 1);
}

/**
 * Lays out one cluster (in start order) with each group taking one level as
 * one card from its first start to its last end, and splits the group's
 * slot into its columns. Gives each card's slot and level, and each group's
 * column width in px (in the order of `groups`).
 */
function placeCluster(
    cluster: Item[],
    groups: Item[][],
    usablePx: number,
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
    // it that it overlaps.
    const levels = new Map<Unit, number>();
    for (let i = 0; i < units.length; i++) {
        let below = 0;
        for (let j = 0; j < i; j++) {
            if (units[i].start < units[j].end && units[i].end > units[j].start) {
                below = Math.max(below, levels.get(units[j])!);
            }
        }
        levels.set(units[i], below + 1);
    }

    const maxLevel = Math.max(1, ...levels.values());
    const width = Math.max(MIN_WIDTH, 100 - (maxLevel - 1) * CASCADE_STEP);
    const step = maxLevel > 1 ? (100 - width) / (maxLevel - 1) : 0;
    const gap = usablePx > 0 ? SIDE_BY_SIDE_GAP_PX / usablePx * 100 : 0;

    const slots = new Map<Item, { width: number; left: number; level: number }>();
    const columnWidthPx = new Array<number>(groups.length).fill(0);
    for (const unit of units) {
        const level = levels.get(unit)!;
        const left = (level - 1) * step;
        if (unit.members.length === 1) {
            slots.set(unit.members[0], { width, left, level });
            continue;
        }
        const { columns, columnCount } = assignFirstFreeColumns(unit.members, m => m.start, m => m.end);
        const slotPx = width / 100 * usablePx;
        const columnPx = (slotPx - (columnCount - 1) * SIDE_BY_SIDE_GAP_PX) / columnCount;
        const columnWidth = columnPx / usablePx * 100;
        unit.members.forEach((member, i) => {
            slots.set(member, { width: columnWidth, left: left + columns[i] * (columnWidth + gap), level });
        });
        columnWidthPx[groups.indexOf(unit.members)] = columnPx;
    }
    return { slots, columnWidthPx };
}
