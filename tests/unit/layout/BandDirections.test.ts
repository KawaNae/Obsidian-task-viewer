import { describe, it, expect } from 'vitest';
import { MAX_CARDS_DECIDED_TOGETHER, chooseBandDirections } from '../../../src/views/timelineview/BandDirections';
import {
    bandClash,
    cardRange,
    coversTop,
    namesMeet,
    overlaps,
    type BandDirection,
    type CardRange,
} from '../../../src/views/timelineview/CardRanges';

// The halo traced round a band reaches 3px below it (`--task-card-halo-block`).
const HALO = 3;

function minutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/** A day's cards at a zoom of 1px a minute, from `id hh:mm-hh:mm` entries. */
function day(cards: string): Map<string, CardRange> {
    return new Map(cards.split(',').map(entry => {
        const [id, span] = entry.trim().split(/\s+/);
        const [start, end] = span.split('-').map(minutes);
        return [id, cardRange(start, end, 1)];
    }));
}

/** Each short card's direction, by its ID, in the order the cards are given. */
function directions(cards: string): Record<string, BandDirection> {
    const ranges = day(cards);
    const chosen = chooseBandDirections([...ranges.values()], HALO);
    const out: Record<string, BandDirection> = {};
    for (const [id, range] of ranges) {
        const dir = chosen.get(range);
        if (dir) out[id] = dir;
    }
    return out;
}

/** `n` cards of 5 minutes, one every 5 minutes from 10:00. */
function run(n: number): string {
    return Array.from({ length: n }, (_, i) => {
        const at = (m: number) => `${10 + Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
        return `k${i + 1} ${at(i * 5)}-${at(i * 5 + 5)}`;
    }).join(', ');
}

describe('chooseBandDirections', () => {
    it('puts up the first of two short cards beside a long one, its band over the long card\'s body', () => {
        expect(directions('C 10:00-15:00, g1 10:30-10:35, g2 10:40-10:45')).toEqual({ g1: 'up', g2: 'down' });
    });

    it('puts up the first of two short cards 10 minutes apart, so neither band hides the other', () => {
        expect(directions('g1 10:30-10:35, g2 10:40-10:45')).toEqual({ g1: 'up', g2: 'down' });
    });

    it('puts up the first two of four short cards in a row before a long one', () => {
        expect(directions('k1 10:30-10:35, k2 10:35-10:40, k3 10:40-10:45, k4 10:45-10:50, T 10:50-12:00'))
            .toEqual({ k1: 'up', k2: 'up', k3: 'down', k4: 'down' });
    });

    it('puts up a short card whose band going down would hide the name of the card after it', () => {
        expect(directions('g 10:30-10:35, v 10:40-12:00')).toEqual({ g: 'up' });
    });

    it('keeps down a short card right after a long one, whose name its band going up would hide no more', () => {
        expect(directions('P 09:00-10:30, g 10:30-10:35')).toEqual({ g: 'down' });
    });

    it('puts up a short card between two long ones, over the earlier\'s body and clear of the later\'s name', () => {
        expect(directions('P 09:00-10:30, g 10:30-10:35, v 10:35-12:00')).toEqual({ g: 'up' });
    });

    it('keeps down two short cards at one time, whose bands meet whichever way they go', () => {
        expect(directions('a 11:00-11:05, b 11:00-11:05')).toEqual({ a: 'down', b: 'down' });
    });

    it('puts up the short cards, one of no length, whose bands going down would hide a later name', () => {
        expect(directions('c 09:15-09:20, d 09:40-09:40, b 09:55-10:10, L 10:20-12:00'))
            .toEqual({ c: 'up', d: 'up', b: 'down' });
    });

    it('keeps down a short card whose band going up would rise above the lane\'s first minute', () => {
        expect(directions('g 00:00-00:05, h 00:05-00:10, L 00:15-02:00')).toEqual({ g: 'down', h: 'down' });
    });

    it('puts the earlier card up where either card going up costs the same', () => {
        // a up and b down, or a down and b up: one band hides a name, no
        // card moves its content down, one band goes up.
        expect(directions('a 10:00-10:05, b 10:20-10:25, L 10:25-10:55')).toEqual({ a: 'up', b: 'down' });
    });

    it('puts up the first half of eight short cards in a row', () => {
        expect(Object.values(directions(run(8))))
            .toEqual(['up', 'up', 'up', 'up', 'down', 'down', 'down', 'down']);
    });

    it('for now, chooses a set too large to try every way of in lots, each counted against the lots before it', () => {
        // The first lot goes as that many cards alone would. The second,
        // alone, would go the same way; counted against the first lot's
        // bands, it goes another.
        const n = MAX_CARDS_DECIDED_TOGETHER;
        const lot = Object.values(directions(run(n)));
        const both = Object.values(directions(run(2 * n)));
        expect(n).toBe(12);
        expect(lot).toEqual(['up', 'up', 'up', 'down', 'down', 'down', 'up', 'up', 'down', 'down', 'down', 'down']);
        expect(both.slice(0, n)).toEqual(lot);
        expect(both.slice(n))
            .toEqual(['up', 'up', 'up', 'down', 'down', 'down', 'down', 'up', 'up', 'down', 'down', 'down']);
    });
});

describe('CardRanges', () => {
    // A short card at the lane's top whose band reaches 22px, and a long
    // card starting 10px lower with its name's first line 35px down: the
    // band and its halo cover 22 + 3 - 10 = 15px of its top.
    const s: CardRange = { start: 0, end: 5, topPx: 0, heightPx: 2, short: true, nameRowPx: 22 };
    const longOf = (heightPx: number): CardRange =>
        ({ start: 10, end: 70, topPx: 10, heightPx, short: false, nameRowPx: 35 });

    it('takes a band going down as covering a long card\'s top that can move its content down exactly as far', () => {
        // 52 - 2 - 35 = 15px of room.
        expect(coversTop(s, 'down', longOf(52), HALO)).toBe(true);
        expect(bandClash(s, 'down', longOf(52), 'down', HALO)).toBe(false);
    });

    it('takes a band going down as hiding the name of a long card that can move its content 0.1px less', () => {
        expect(coversTop(s, 'down', longOf(51.9), HALO)).toBe(false);
        expect(bandClash(s, 'down', longOf(51.9), 'down', HALO)).toBe(true);
    });

    it('takes a card of no length and a long card starting with it as overlapping by the band, whichever way it goes', () => {
        const cards = day('point 17:00-17:00, long 17:00-18:00');
        const point = cards.get('point')!;
        const long = cards.get('long')!;
        for (const dir of ['up', 'down'] as const) {
            expect(bandClash(point, dir, long, 'down', HALO)).toBe(true);
            expect(overlaps(point, dir, long, 'down', HALO)).toBe(true);
        }
    });

    it('takes two long cards as overlapping only in time, and their names as meeting by any share', () => {
        const cards = day('a 10:00-11:00, b 10:34-11:00, c 11:00-12:00');
        const [a, b, c] = ['a', 'b', 'c'].map(id => cards.get(id)!);
        expect(overlaps(a, 'down', b, 'down', HALO)).toBe(true);
        expect(overlaps(a, 'down', c, 'down', HALO)).toBe(false);
        // a's name runs to 34.8px, b starts 34px down.
        expect(namesMeet(a, 'down', b, 'down')).toBe(true);
        expect(namesMeet(a, 'down', cards.get('c')!, 'down')).toBe(false);
    });
});
