import { describe, it, expect } from 'vitest';
import { TaskLayout } from '../../../src/views/timelineview/TaskLayout';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { makeTask } from '../helpers/makeTask';
import { MAX_OPEN_CARDS_IN_REACH, chooseBandDirections } from '../../../src/views/timelineview/BandDirections';
import {
    bandClash,
    bandRangePx,
    cardRange,
    coversTop,
    namesMeet,
    overlaps,
    type BandDirection,
    type CardRange,
} from '../../../src/views/timelineview/CardRanges';

// The halo traced round a band reaches 3px below it (`--task-card-halo-block`).
const HALO = 3;
// The day's 24 hours at a zoom of 1px a minute.
const DAY = 24 * 60;

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
    const chosen = chooseBandDirections([...ranges.values()], HALO, DAY);
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

    it('puts up a short card whose band going up rises to the lane\'s top as drawn, 1px below its range, and no higher', () => {
        // Going down, a's band would make b move its content down.
        expect(directions('a 00:19-00:24, b 00:30-01:30')).toEqual({ a: 'up' });
        expect(directions('a 00:18-00:23, b 00:29-01:29')).toEqual({ a: 'down' });
    });

    it('puts up a short card whose band going down would hang below the lane\'s bottom as drawn, inside its border', () => {
        // Drawn from 1416px, the band going down ends at the lane's 1438px.
        expect(directions('g 23:35-23:40')).toEqual({ g: 'down' });
        expect(directions('g 23:36-23:41')).toEqual({ g: 'up' });
        expect(directions('g 23:55-24:00')).toEqual({ g: 'up' });
    });

    it('takes the lane\'s bottom at the day\'s end at the lane\'s scale, as TaskLayout lays the cards out', () => {
        const at = (hhmm: string) => new Date(2026, 2, 11, ...hhmm.split(':').map(Number) as [number, number]).getTime();
        const card = (id: string, start: string, end: string) => ({
            ...toDisplayTask(makeTask({ id, content: id, startDate: '2026-03-11' }), 0, NO_TASK_LOOKUP),
            drawn: { startMs: at(start), endMs: at(end) },
        });
        const band = (zoom: number, start: string, end: string) => TaskLayout.calculateTaskLayout([card('g', start, end)], 0, {
            pxPerMinute: zoom, widthPx: 0, bandInsetPx: 0, bandHaloBlockPx: HALO, narrowestSideBySidePx: null,
        }).get('g')!.band;
        // At half a pixel a minute, 23:50 is 715px down a lane 720px tall;
        // at 2px a minute, 12:00 is halfway down.
        expect(band(0.5, '23:50', '23:55')).toBe('up');
        expect(band(2, '12:00', '12:05')).not.toBe('up');
    });

    it('keeps down a short card held up at the lane\'s bottom by the card before it, where going up would clash with it all the same', () => {
        // Apart from the bottom, h goes up and g down, as two cards 10
        // minutes apart do; with g up, h's band meets g's either way.
        expect(directions('h 10:30-10:35, g 10:40-10:45')).toEqual({ h: 'up', g: 'down' });
        expect(directions('h 23:30-23:35, g 23:40-23:45')).toEqual({ h: 'down', g: 'up' });
    });

    it('keeps down a short card whose band would leave the lane going up and going down', () => {
        // In a lane 50px tall, a card 30 minutes down leaves it going down
        // only; in one 20px tall, a card at the top leaves it either way.
        const low = cardRange(30, 35, 1);
        const top = cardRange(0, 5, 1);
        expect(chooseBandDirections([low], HALO, 50).get(low)).toBe('up');
        expect(chooseBandDirections([top], HALO, 20).get(top)).toBe('down');
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

    it('decides a run of 14 short cards as a whole, at the least cost of every way', () => {
        const ranges = [...day(run(14)).values()];
        expect(costOf(ranges, chooseBandDirections(ranges, HALO, DAY))).toEqual(costOf(ranges, cheapestOfAll(ranges, DAY)));
    });

    it('gives each short card the direction the cheapest of every way gives it, the earlier cards up on a tie', () => {
        let seed = 7;
        const next = () => {
            seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        const lengths = [0, 0, 5, 5, 10, 15, 30, 45, 60, 120];
        for (let scene = 0; scene < 1500; scene++) {
            const zoom = [0.5, 1, 2][scene % 3];
            const from = [0, 600, 1300][Math.floor(next() * 3)];
            const ranges = Array.from({ length: 2 + Math.floor(next() * 9) }, () => {
                const start = Math.min(1440, from + Math.floor(next() * 140));
                return cardRange(start, Math.min(1440, start + lengths[Math.floor(next() * lengths.length)]), zoom);
            });
            if (ranges.filter(r => r.short).length > 8) continue;
            const chosen = chooseBandDirections(ranges, HALO, DAY * zoom);
            const cheapest = cheapestOfAll(ranges, DAY * zoom);
            for (const r of ranges.filter(r => r.short)) expect(chosen.get(r)).toBe(cheapest.get(r));
        }
    });

    it('keeps down the short card that would make more open cards in reach of one another than are weighed together', () => {
        // Cards of no length at one time hide each other's bands whichever
        // way they go, and a band going down makes the long card move its
        // content down, so all go up but the one past the limit. The last
        // card has no card after it to be weighed against, so it is open.
        const n = MAX_OPEN_CARDS_IN_REACH;
        const points = (count: number) => Array.from({ length: count }, (_, i) => `p${i} 10:00-10:00`).join(', ');
        expect(Object.values(directions(`${points(n + 1)}, L 10:05-12:00`))).toEqual(Array(n + 1).fill('up'));
        expect(Object.values(directions(`${points(n + 2)}, L 10:05-12:00`)))
            .toEqual([...Array(n).fill('up'), 'down', 'up']);
    });
});

type Cost = [number, number, number];

/** What a way of the bands costs: bands hiding a name, longer cards moving their content down, bands going up. */
function costOf(cards: CardRange[], dirs: Map<CardRange, BandDirection>): Cost {
    const shorts = cards.filter(c => c.short);
    const cost: Cost = [0, 0, 0];
    for (const s of shorts) {
        const d = dirs.get(s)!;
        if (d === 'up') cost[2]++;
        for (const x of cards.filter(c => !c.short)) {
            if (coversTop(s, d, x, HALO)) cost[1]++;
            else if (bandClash(s, d, x, 'down', HALO)) cost[0]++;
        }
    }
    shorts.forEach((a, i) => shorts.slice(i + 1).forEach(b => {
        if (bandClash(a, dirs.get(a)!, b, dirs.get(b)!, HALO)) cost[0]++;
    }));
    return cost;
}

/**
 * The cheapest way of all, every way tried in start order with up before
 * down and the first of the cheapest kept. A card is drawn 1px below its
 * `topPx`, in a lane 2px shorter than `dayPx` for its borders; a band that
 * would leave the lane at the top goes down, and one that would leave it
 * at the bottom only, up.
 */
function cheapestOfAll(cards: CardRange[], dayPx: number): Map<CardRange, BandDirection> {
    const offTop = (s: CardRange) => bandRangePx(s, 'up')[0] + 1 < 0;
    const offBottom = (s: CardRange) => bandRangePx(s, 'down')[1] + 1 > dayPx - 2;
    const shorts = cards.filter(c => c.short)
        .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    let best: { cost: Cost; dirs: Map<CardRange, BandDirection> } | null = null;
    for (let v = 0; v < 1 << shorts.length; v++) {
        const dirs = new Map(shorts.map((s, p): [CardRange, BandDirection] =>
            [s, (v >> (shorts.length - 1 - p)) & 1 ? 'down' : 'up']));
        if (shorts.some(s => dirs.get(s) === 'up' && offTop(s))) continue;
        if (shorts.some(s => dirs.get(s) === 'down' && offBottom(s) && !offTop(s))) continue;
        const cost = costOf(cards, dirs);
        const cheaper = !best || cost[0] - best.cost[0] || cost[1] - best.cost[1] || cost[2] - best.cost[2];
        if (!best || (cheaper as number) < 0) best = { cost, dirs };
    }
    return best!.dirs;
}

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
