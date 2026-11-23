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
 * ranges and a short card's band direction. Where a band or a name lies
 * is told in px; whether two cards' times overlap, and whether one starts
 * once the other has ended, in minutes. A card's body is drawn shorter
 * than its time (`cardHeightPx`), so two cards whose times overlap by a
 * little overlap though their bodies do not meet.
 *
 * `topPx` is the card's start minute times the zoom, so the lane's first
 * minute is at 0. CSS draws every card `CARD_DRAWN_LOWER_PX`
 * (`TimedCardGeometry`) lower than that; the shift is the same for every
 * card, so it changes no relation between two cards.
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

/** Start order, the longer first on a tie, so of two cards starting together the shorter is laid on top. */
export function byStart(a: { start: number; end: number }, b: { start: number; end: number }): number {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
}

/**
 * Whether two times overlap, each starting before the other ends. A card
 * of no length overlaps no card in time.
 */
export function timesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
    return a.start < b.end && b.start < a.end;
}

/** Whether two ranges share 1px or more. */
export function meetByPx(a: PxRange, b: PxRange): boolean {
    return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) >= 1;
}

/** A card's body, from its top to its bottom. */
export function bodyRangePx(card: CardRange): PxRange {
    return [card.topPx, card.topPx + card.heightPx];
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
 * How far into a short card's band the band of another short card in
 * front may reach and leave its name legible. The name's line lies 3px
 * inside the band's top and bottom edges, and the band in front traces a
 * halo 3px past its own edge, so the halo covers as much of the line as
 * the two bands meet by. The glyphs' ink lies 1.3px to 1.7px inside the
 * line, so bands meeting by 1px cut no glyph, and by just under 2px cut
 * no more than half a pixel off one.
 */
const BAND_EDGE_CLEAR_OF_GLYPHS_PX = 1;

/**
 * Where a card's name can be hidden: a short card's band going `dir`, but
 * for `BAND_EDGE_CLEAR_OF_GLYPHS_PX` at its top and its bottom, or from a
 * longer card's top to the bottom of its name's first line, whatever
 * `dir`. A longer card's line keeps its edges: where its glyphs lie
 * against the halo of a band over it is not known here, so a band over it
 * by 1px or more hides it.
 */
function nameRangePx(card: CardRange, dir: BandDirection): PxRange {
    if (card.short) {
        const [top, bottom] = bandRangePx(card, dir);
        return [top + BAND_EDGE_CLEAR_OF_GLYPHS_PX, bottom - BAND_EDGE_CLEAR_OF_GLYPHS_PX];
    }
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

/**
 * Whether short card `s`'s band hides `x`'s name: it lies over where the
 * name can be hidden (`nameRangePx`) by 1px or more, so over a short
 * card's band by 2px or more, `x` not moving out from under it.
 */
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
 * Whether two cards overlap: their times overlap (`timesOverlap`), or
 * their bands clash. A card of no length overlaps one starting with it
 * only by its band.
 */
export function overlaps(
    a: CardRange,
    aDir: BandDirection,
    b: CardRange,
    bDir: BandDirection,
    haloPx: number,
): boolean {
    return timesOverlap(a, b) || bandClash(a, aDir, b, bDir, haloPx);
}
