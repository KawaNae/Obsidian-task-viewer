import {
    CONTENT_SHIFT_FOOT_PX,
    NAME_BAND_BELOW_PX,
    NAME_BAND_HEIGHT_PX,
    cardHeightPx,
    nameRowHeightPx,
} from './TimedCardGeometry';

/**
 * The way a short card's name band hangs: `down` from the card's top, as
 * over the cards after it, or `up` from its bottom, over the cards before.
 */
export type BandDirection = 'up' | 'down';

/**
 * A timed card's place down its day's lane, in minutes of its visual day
 * and in px at one zoom. Whether two cards overlap, whose name one would
 * hide, and whose content a band moves down are all told from these
 * ranges and a short card's band direction, and from nothing else.
 *
 * `topPx` is the card's start minute times the zoom, so the lane's first
 * minute is at 0. CSS draws every card 1px lower than that; the shift is
 * the same for every card, so it changes no relation between two cards.
 * `short` marks a card too low to show its name inside, which shows it in
 * a band of its own instead; `nameRowPx` is from the card's top to the
 * bottom of its name's first line, or the band's height for a short card.
 */
export interface CardRange {
    start: number;
    end: number;
    topPx: number;
    heightPx: number;
    short: boolean;
    nameRowPx: number;
}

/** A range down the lane in px, from its top to its bottom. */
export type PxRange = readonly [number, number];

/** The range of a card from `start` to `end`, minutes of its visual day, `pxPerMinute` to a minute. */
export function cardRange(start: number, end: number, pxPerMinute: number): CardRange {
    const heightPx = cardHeightPx(end - start, pxPerMinute);
    return {
        start,
        end,
        topPx: start * pxPerMinute,
        heightPx,
        short: heightPx < NAME_BAND_BELOW_PX,
        nameRowPx: nameRowHeightPx(end - start, pxPerMinute),
    };
}

/** Whether two ranges share 1px or more. */
export function meetByPx(a: PxRange, b: PxRange): boolean {
    return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) >= 1;
}

/** A short card's band going `dir`: down from its top, or up from its bottom. */
export function bandRangePx(card: CardRange, dir: BandDirection): PxRange {
    if (dir === 'up') {
        const bottom = card.topPx + card.heightPx;
        return [bottom - NAME_BAND_HEIGHT_PX, bottom];
    }
    return [card.topPx, card.topPx + NAME_BAND_HEIGHT_PX];
}

/**
 * Where a card shows its name: a short card's band going `dir`, or from a
 * longer card's top to the bottom of its name's first line, whatever `dir`.
 */
export function nameRangePx(card: CardRange, dir: BandDirection): PxRange {
    if (card.short) return bandRangePx(card, dir);
    return [card.topPx, card.topPx + card.nameRowPx];
}

/**
 * Whether short card `s`'s band going `sDir` covers the top of a longer
 * card `x` that moves its content down out from under it, so the band
 * hides nothing of `x`'s name: the band goes down, `x` starts once `s` has
 * ended, the band lies over `x`'s name by 1px or more, and what the band
 * and its halo (`haloPx` below the band) cover of `x`'s top is no more
 * than `x` can move its content down and keep its name's first line whole.
 */
export function coversTop(s: CardRange, sDir: BandDirection, x: CardRange, haloPx: number): boolean {
    if (!s.short || sDir !== 'down' || x.short || x.start < s.end) return false;
    if (!meetByPx(bandRangePx(s, sDir), nameRangePx(x, 'down'))) return false;
    const coverPx = NAME_BAND_HEIGHT_PX + haloPx - (x.topPx - s.topPx);
    return coverPx <= x.heightPx - CONTENT_SHIFT_FOOT_PX - x.nameRowPx;
}

/** Whether short card `s`'s band hides `x`'s name: it lies over it by 1px or more, `x` not moving out from under it. */
function bandHides(s: CardRange, sDir: BandDirection, x: CardRange, xDir: BandDirection, haloPx: number): boolean {
    return s.short
        && meetByPx(bandRangePx(s, sDir), nameRangePx(x, xDir))
        && !coversTop(s, sDir, x, haloPx);
}

/**
 * Whether the band of one of two cards, a short card's going its way,
 * hides the other's name (`coversTop` aside). Two longer cards never
 * clash, whatever their directions.
 */
export function bandClash(
    a: CardRange,
    aDir: BandDirection,
    b: CardRange,
    bDir: BandDirection,
    haloPx: number,
): boolean {
    return bandHides(a, aDir, b, bDir, haloPx) || bandHides(b, bDir, a, aDir, haloPx);
}

/**
 * Whether two cards overlap: their times overlap, each starting before the
 * other ends, or their bands clash. A card of no length overlaps no card
 * in time, so it overlaps one starting with it only by its band.
 */
export function overlaps(
    a: CardRange,
    aDir: BandDirection,
    b: CardRange,
    bDir: BandDirection,
    haloPx: number,
): boolean {
    return (a.start < b.end && b.start < a.end) || bandClash(a, aDir, b, bDir, haloPx);
}

/**
 * Whether two cards' names lie at one height: by any share between two
 * longer cards, and by 1px or more where one shows its name in a band.
 */
export function namesMeet(a: CardRange, aDir: BandDirection, b: CardRange, bDir: BandDirection): boolean {
    const ra = nameRangePx(a, aDir);
    const rb = nameRangePx(b, bDir);
    if (!a.short && !b.short) return Math.min(ra[1], rb[1]) - Math.max(ra[0], rb[0]) > 0;
    return meetByPx(ra, rb);
}
