import {
    bandClash,
    bandRangePx,
    byStart,
    coversTop,
    type BandDirection,
    type CardRange,
} from './CardRanges';
import { CARD_DRAWN_LOWER_PX } from './TimedCardGeometry';

/**
 * The most short cards whose directions are open and whose bands may still
 * meet the bands of the cards after them: each one more doubles the ways
 * the cards after them are weighed against (`chooseBandDirections`). A card
 * that would make one more keeps its band down.
 */
export const MAX_OPEN_CARDS_IN_REACH = 12;

/** 0 up, 1 down: the bit a short card's direction is written as. */
const DIRECTIONS: readonly BandDirection[] = ['up', 'down'];
const UP = 0;
const DOWN = 1;

/**
 * What one way of the bands costs, compared in this order, the least
 * winning: bands hiding a name (`bandClash`), longer cards made to move
 * their content down under a band (`coversTop`), bands going up.
 */
type Cost = [clashes: number, coveredTops: number, ups: number];

/** The costs of the ways of the cards from one place on, one for each way of the open cards before it. */
interface Costs {
    clashes: Int32Array;
    coveredTops: Int32Array;
    ups: Int32Array;
}

function costsOf(size: number): Costs {
    return { clashes: new Int32Array(size), coveredTops: new Int32Array(size), ups: new Int32Array(size) };
}

/** Whether `a` costs less than `b`'s entry `j`, compared in `Cost`'s order. */
function cheaperThan(a: Cost, b: Costs, j: number): boolean {
    if (a[0] !== b.clashes[j]) return a[0] < b.clashes[j];
    if (a[1] !== b.coveredTops[j]) return a[1] < b.coveredTops[j];
    return a[2] < b.ups[j];
}

function sameAs(a: Cost, b: Costs, j: number): boolean {
    return a[0] === b.clashes[j] && a[1] === b.coveredTops[j] && a[2] === b.ups[j];
}

/** The number of bits set in `x`. */
function bitCount(x: number): number {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** What a short card can do: go either way, or only `up` or `down`. */
type Choice = 'open' | BandDirection;

/** What one short card adds to a way's cost, read by its place `k` in start order. */
interface Step {
    choice: Choice;
    /** The open cards before it whose bands may still meet a band from here on, by start order, the earliest at bit 0. */
    open: number[];
    /** How many of `open`, and of the card itself when it is open, from the earliest, no band from the next card on can meet. */
    dropped: number;
    /** By its direction: what it costs against the longer cards and the cards before it whose direction is not open, and itself going up. */
    fixed: [Cost, Cost];
    /** By its direction: the bits of `open` whose band hides a name or its name, the open card going up, and going down. */
    clashIfUp: [number, number];
    clashIfDown: [number, number];
}

/**
 * The direction of each short card's name band among a day's `cards`, by
 * the fewest bands hiding a name, then the fewest longer cards moving
 * their content down, then the fewest bands going up. `haloPx` is how far
 * the halo traced round a band reaches below it. Longer cards have no
 * band and are not in the map; two of them cost the same whichever way
 * the bands go, so they are not counted.
 *
 * Of the ways of the bands that cost the least, the one kept has the
 * earlier cards up: written in start order, up before down, it comes
 * first. A short card's cost is its own (against the longer cards, and
 * whether it goes up) and one for each other short card its band can
 * meet. So the cards are taken in start order, and at each card only the
 * directions of the cards before it whose bands may still meet a band from
 * there on change what the rest costs. Those cards lie within a band's
 * height or so of it, and the work at each card grows with how many of
 * them there are, not with the day's cards.
 *
 * A band is kept in the lane where it is drawn, `laneHeightPx` tall
 * (`laneHeightPx` of `TimedCardGeometry`), each card `CARD_DRAWN_LOWER_PX`
 * lower than its range. A band going up that would rise above the lane's
 * top is not tried: above the lane is the all-day row or the day's header,
 * which the band would lie over. A band going down that would hang below
 * the lane's bottom is not tried either, unless the band going up would
 * rise above the top too, when it goes down.
 *
 * Where more than `MAX_OPEN_CARDS_IN_REACH` short cards whose direction is
 * open would be in reach of the cards after them, the card that would make
 * one more, in start order, keeps its band down, as two cards at one time
 * do whose bands meet whichever way they go. Which card that is follows
 * from the cards' places alone.
 */
export function chooseBandDirections(
    cards: readonly CardRange[],
    haloPx: number,
    laneHeightPx: number,
): Map<CardRange, BandDirection> {
    const shorts = cards.filter(card => card.short).sort(byStart);
    const steps = stepsOf(shorts, cards.filter(card => !card.short), haloPx, laneHeightPx);
    const n = shorts.length;

    // From the last card back: `after[k]` is, for each way of `steps[k].open`,
    // the least the cards from k on cost.
    const after: Costs[] = new Array(n + 1);
    const cost: Cost = [0, 0, 0];
    after[n] = costsOf(1);
    for (let k = n - 1; k >= 0; k--) {
        const step = steps[k];
        const rest = after[k + 1];
        const here = costsOf(1 << step.open.length);
        const ways = directionsOf(step.choice);
        for (let m = 0; m < 1 << step.open.length; m++) {
            let first = true;
            for (const d of ways) {
                costOfStep(step, m, d, rest, cost);
                if (first || cheaperThan(cost, here, m)) {
                    first = false;
                    here.clashes[m] = cost[0];
                    here.coveredTops[m] = cost[1];
                    here.ups[m] = cost[2];
                }
            }
        }
        after[k] = here;
    }

    // From the first card on, each going up if the least cost still holds.
    const directions = new Map<CardRange, BandDirection>();
    let m = 0;
    for (let k = 0; k < n; k++) {
        const step = steps[k];
        const d = directionsOf(step.choice).find(d => sameAs(costOfStep(step, m, d, after[k + 1], cost), after[k], m))!;
        directions.set(shorts[k], DIRECTIONS[d]);
        m = nextWay(step, m, d);
    }
    return directions;
}

function directionsOf(choice: Choice): number[] {
    if (choice === 'open') return [UP, DOWN];
    return [choice === 'up' ? UP : DOWN];
}

/** The way of the next step's open cards, after card `step` goes `d` with the open cards before it going `m`. */
function nextWay(step: Step, m: number, d: number): number {
    const all = step.choice === 'open' ? m | (d << step.open.length) : m;
    return all >>> step.dropped;
}

/** What the cards from `step` on cost, it going `d` and the open cards before it `m`, the rest at their least: written to `out`. */
function costOfStep(step: Step, m: number, d: number, rest: Costs, out: Cost): Cost {
    const own = step.fixed[d];
    const downs = m & step.clashIfDown[d];
    const ups = ~m & ((1 << step.open.length) - 1) & step.clashIfUp[d];
    const j = nextWay(step, m, d);
    out[0] = own[0] + bitCount(downs) + bitCount(ups) + rest.clashes[j];
    out[1] = own[1] + rest.coveredTops[j];
    out[2] = own[2] + rest.ups[j];
    return out;
}

/**
 * Each short card's `Step`, `shorts` in start order. Whether two bands
 * can meet is told first by the span both directions of a band cover
 * together: a card whose span ends 1px or less below the top of every
 * later card's span meets none of them.
 */
function stepsOf(shorts: CardRange[], longs: CardRange[], haloPx: number, laneHeightPx: number): Step[] {
    const n = shorts.length;
    const spans = shorts.map(s => {
        const up = bandRangePx(s, 'up');
        const down = bandRangePx(s, 'down');
        return [Math.min(up[0], down[0]), Math.max(up[1], down[1])] as const;
    });
    // The highest top of a span from card k on.
    const highestFrom = new Array<number>(n + 1);
    highestFrom[n] = Infinity;
    for (let k = n - 1; k >= 0; k--) highestFrom[k] = Math.min(spans[k][0], highestFrom[k + 1]);
    const reaches = (i: number, k: number) => spans[i][1] - highestFrom[k] >= 1;

    const ownCosts = ownCostsAgainst(shorts, spans, longs, haloPx);
    const steps: Step[] = [];
    const chosen: (BandDirection | null)[] = shorts.map(() => null);
    let open: number[] = [];
    let fixed: number[] = [];
    for (let k = 0; k < n; k++) {
        const s = shorts[k];
        fixed = fixed.filter(i => reaches(i, k));
        const step: Step = {
            choice: choiceInLane(s, laneHeightPx),
            open,
            dropped: 0,
            fixed: [[...ownCosts[k][UP]] as Cost, [...ownCosts[k][DOWN]] as Cost],
            clashIfUp: [0, 0],
            clashIfDown: [0, 0],
        };
        for (const d of [UP, DOWN]) {
            for (const i of fixed) {
                if (bandClash(shorts[i], chosen[i]!, s, DIRECTIONS[d], haloPx)) step.fixed[d][0]++;
            }
            open.forEach((i, p) => {
                if (bandClash(shorts[i], 'up', s, DIRECTIONS[d], haloPx)) step.clashIfUp[d] |= 1 << p;
                if (bandClash(shorts[i], 'down', s, DIRECTIONS[d], haloPx)) step.clashIfDown[d] |= 1 << p;
            });
        }
        // The cards in reach of the next one, earliest first; a card past
        // the first that reaches it stays, whether or not it reaches.
        const ahead = (list: number[]) => {
            let from = 0;
            while (from < list.length && !reaches(list[from], k + 1)) from++;
            return from;
        };
        if (step.choice === 'open') {
            const withIt = [...open, k];
            if (withIt.length - ahead(withIt) > MAX_OPEN_CARDS_IN_REACH) step.choice = 'down';
        }
        if (step.choice === 'open') {
            const withIt = [...open, k];
            step.dropped = ahead(withIt);
            open = withIt.slice(step.dropped);
        } else {
            step.dropped = ahead(open);
            open = open.slice(step.dropped);
            chosen[k] = step.choice;
            fixed.push(k);
        }
        steps.push(step);
    }
    return steps;
}

/** Which ways a short card's band can go and stay in a lane `lanePx` tall, where it is drawn. */
function choiceInLane(s: CardRange, lanePx: number): Choice {
    if (bandRangePx(s, 'up')[0] + CARD_DRAWN_LOWER_PX < 0) return 'down';
    if (bandRangePx(s, 'down')[1] + CARD_DRAWN_LOWER_PX > lanePx) return 'up';
    return 'open';
}

/**
 * Each short card's cost against the longer cards, for each direction,
 * with 1 for going up. A band can hide only the names that lie within its
 * `span`, so only the longer cards whose names start there or less than
 * the longest name row above it are tried.
 */
function ownCostsAgainst(
    shorts: CardRange[],
    spans: (readonly [number, number])[],
    longs: CardRange[],
    haloPx: number,
): [Cost, Cost][] {
    const byTop = longs.slice().sort((a, b) => a.topPx - b.topPx);
    const longestNameRow = byTop.reduce((most, x) => Math.max(most, x.nameRowPx), 0);
    return shorts.map((s, k) => {
        const [top, bottom] = spans[k];
        let from = 0;
        let to = byTop.length;
        while (from < to) {
            const mid = (from + to) >> 1;
            if (byTop[mid].topPx + longestNameRow <= top) from = mid + 1;
            else to = mid;
        }
        return DIRECTIONS.map((dir): Cost => {
            let clashes = 0;
            let coveredTops = 0;
            for (let i = from; i < byTop.length && byTop[i].topPx < bottom; i++) {
                const x = byTop[i];
                if (coversTop(s, dir, x, haloPx)) coveredTops++;
                else if (bandClash(s, dir, x, 'down', haloPx)) clashes++;
            }
            return [clashes, coveredTops, dir === 'up' ? 1 : 0];
        }) as [Cost, Cost];
    });
}
