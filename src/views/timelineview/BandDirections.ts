import {
    bandClash,
    bandRangePx,
    coversTop,
    type BandDirection,
    type CardRange,
} from './CardRanges';

/**
 * The most short cards whose directions are chosen together, every way
 * they could go tried. Each card more doubles the ways; a larger set is
 * taken this many cards at a time in start order (`chooseBandDirections`).
 */
export const MAX_CARDS_DECIDED_TOGETHER = 12;

const DIRECTIONS: readonly BandDirection[] = ['up', 'down'];

/**
 * What one way of the bands costs, compared in this order, the least
 * winning: bands hiding a name (`bandClash`), longer cards made to move
 * their content down under a band (`coversTop`), bands going up.
 */
type Cost = [clashes: number, coveredTops: number, ups: number];

function cheaper(a: Cost, b: Cost): boolean {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
}

/** Start order, the longer first on a tie. */
function byStart(a: CardRange, b: CardRange): number {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
}

/**
 * The direction of each short card's name band among a day's `cards`, by
 * the fewest bands hiding a name, then the fewest longer cards moving
 * their content down, then the fewest bands going up. `haloPx` is how far
 * the halo traced round a band reaches below it. Longer cards have no
 * band and are not in the map; two of them cost the same whichever way
 * the bands go, so they are not counted.
 *
 * Only short cards whose bands could meet, one way or the other, change
 * each other's cost, so the cards are split into sets joined by such
 * pairs and each set is chosen on its own. A set's ways are tried in the
 * order of its cards' directions written in start order, up before down,
 * and the first of the cheapest is kept, so on a tie the earlier cards go
 * up. A set of more than `MAX_CARDS_DECIDED_TOGETHER` cards is chosen that
 * many cards at a time in start order, each lot counted also against the
 * cards of the lots before it.
 *
 * A band going up that would rise above the lane's first minute (`topPx`
 * 0) is not tried: above the lane is the all-day row or the day's header,
 * which the band would lie over.
 */
export function chooseBandDirections(cards: readonly CardRange[], haloPx: number): Map<CardRange, BandDirection> {
    const shorts = cards.filter(card => card.short).sort(byStart);
    const longs = cards.filter(card => !card.short);
    const directions = new Map<CardRange, BandDirection>();

    // A short card's own cost against the longer cards, for each direction.
    const own = shorts.map(s => DIRECTIONS.map((dir): Cost => {
        let clashes = 0;
        let coveredTops = 0;
        for (const x of longs) {
            if (coversTop(s, dir, x, haloPx)) coveredTops++;
            else if (bandClash(s, dir, x, 'down', haloPx)) clashes++;
        }
        return [clashes, coveredTops, dir === 'up' ? 1 : 0];
    }));
    const canGoUp = shorts.map(s => bandRangePx(s, 'up')[0] >= 0);

    for (const set of setsWhoseBandsMayMeet(shorts)) {
        const way: number[] = [];
        for (let from = 0; from < set.length; from += MAX_CARDS_DECIDED_TOGETHER) {
            way.push(...cheapestWay(way, Math.min(MAX_CARDS_DECIDED_TOGETHER, set.length - from), {
                canGoUp: p => canGoUp[set[p]],
                own: p => own[set[p]],
                clash: (p, dp, q, dq) =>
                    bandClash(shorts[set[p]], DIRECTIONS[dp], shorts[set[q]], DIRECTIONS[dq], haloPx),
            }));
        }
        set.forEach((i, p) => directions.set(shorts[i], DIRECTIONS[way[p]]));
    }
    return directions;
}

/** The short cards (indices in start order) joined where their bands could meet, one way or the other. */
function setsWhoseBandsMayMeet(shorts: CardRange[]): number[][] {
    const parent = shorts.map((_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const bands = shorts.map(s => DIRECTIONS.map(dir => bandRangePx(s, dir)));
    for (let i = 0; i < shorts.length; i++) {
        for (let j = i + 1; j < shorts.length; j++) {
            const meet = bands[i].some(a => bands[j].some(b => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) >= 1));
            if (meet) parent[find(j)] = find(i);
        }
    }
    const sets = new Map<number, number[]>();
    shorts.forEach((_, i) => {
        const root = find(i);
        const set = sets.get(root);
        if (set) set.push(i);
        else sets.set(root, [i]);
    });
    return [...sets.values()];
}

/** What `cheapestWay` reads of a set's cards, by their place `p` in start order, 0 up and 1 down. */
interface SetCosts {
    canGoUp: (p: number) => boolean;
    own: (p: number) => Cost[];
    clash: (p: number, dp: number, q: number, dq: number) => boolean;
}

/**
 * The cheapest way of the next `n` cards of a set after those `decided`,
 * every way tried, each counted with the clashes among the `n` and with
 * the cards decided. A way is the number whose bits from the highest are
 * the cards' directions in start order, 0 up and 1 down, so counting up
 * tries the earlier cards up first. All down is always open.
 */
function cheapestWay(decided: number[], n: number, costs: SetCosts): number[] {
    const first = decided.length;
    let best: { cost: Cost; way: number[] } | null = null;
    for (let v = 0; v < 1 << n; v++) {
        const way = Array.from({ length: n }, (_, p) => (v >> (n - 1 - p)) & 1);
        if (way.some((d, p) => d === 0 && !costs.canGoUp(first + p))) continue;
        const cost: Cost = [0, 0, 0];
        way.forEach((d, p) => {
            const c = costs.own(first + p)[d];
            cost[0] += c[0];
            cost[1] += c[1];
            cost[2] += c[2];
            for (let q = 0; q < first; q++) {
                if (costs.clash(q, decided[q], first + p, d)) cost[0]++;
            }
            for (let q = p + 1; q < n; q++) {
                if (costs.clash(first + p, d, first + q, way[q])) cost[0]++;
            }
        });
        if (!best || cheaper(cost, best.cost)) best = { cost, way };
    }
    return best!.way;
}
