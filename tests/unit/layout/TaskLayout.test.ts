import { describe, it, expect } from 'vitest';
import { TaskLayout, narrowestSideBySidePx, type LaneSlot, type TimelineLane } from '../../../src/views/timelineview/TaskLayout';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { makeTask } from '../helpers/makeTask';
import type { DisplayTask } from '../../../src/types';
import { cardRange } from '../../../src/views/timelineview/CardRanges';

const START_HOUR = 0;

/**
 * A lane not laid out yet: no width, so no cards are put side by side. The
 * halo is the stylesheet's, reaching 3px past the top or bottom of a card
 * or its band and 4px left and right of a card, which cards put side by
 * side stand apart.
 */
const UNLAID: TimelineLane = {
    pxPerMinute: 1,
    widthPx: 0,
    bandInsetPx: 0,
    haloBlockPx: 3,
    haloInlinePx: 4,
    narrowestSideBySidePx: null,
};

function laneOf(lengths: Partial<TimelineLane>): TimelineLane {
    return { ...UNLAID, ...lengths };
}

function at(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2026, 2, 11, h, m).getTime();
}

function card(id: string, start: string, end: string): DisplayTask {
    const task = toDisplayTask(makeTask({ id, content: id, startDate: '2026-03-11' }), START_HOUR, NO_TASK_LOOKUP);
    return { ...task, drawn: { startMs: at(start), endMs: at(end) } };
}

function ranks(tasks: DisplayTask[]): Record<string, number> {
    const layout = TaskLayout.calculateTaskLayout(tasks, START_HOUR, UNLAID);
    return Object.fromEntries([...layout].map(([id, slot]) => [id, slot.rank]));
}

describe('TaskLayout', () => {
    it('puts the earlier of two cards that do not overlap in time in front', () => {
        const r = ranks([card('short', '23:26', '23:35'), card('next', '23:36', '23:59')]);
        expect(r.short).toBeGreaterThan(r.next);
    });

    it('puts the earlier in front across clusters too, whatever order the cards come in', () => {
        const r = ranks([card('c', '12:00', '13:00'), card('a', '10:00', '10:05'), card('b', '10:05', '11:00')]);
        expect(r.a).toBeGreaterThan(r.b);
        expect(r.b).toBeGreaterThan(r.c);
    });

    it('puts the card shifted right of one it overlaps in front, keeping the widths and offsets', () => {
        const layout = TaskLayout.calculateTaskLayout(
            [card('long', '10:00', '12:00'), card('inner', '10:30', '11:00')],
            START_HOUR,
            UNLAID,
        );
        const long = layout.get('long')!;
        const inner = layout.get('inner')!;
        expect(inner.rank).toBeGreaterThan(long.rank);
        expect(long).toMatchObject({ width: 85, left: 0 });
        expect(inner).toMatchObject({ width: 85, left: 15 });
    });

    it('orders by level first where the pairwise rules would go round in a circle', () => {
        // Q overlaps P, P overlaps R, Q and R do not overlap.
        const layout = TaskLayout.calculateTaskLayout(
            [card('Q', '20:00', '20:10'), card('P', '20:05', '21:00'), card('R', '20:10', '20:20')],
            START_HOUR,
            UNLAID,
        );
        const q = layout.get('Q')!;
        const p = layout.get('P')!;
        const r = layout.get('R')!;
        expect([q.left, p.left, r.left]).toEqual([0, 15, 30]);
        expect(r.rank).toBeGreaterThan(p.rank);
        expect(p.rank).toBeGreaterThan(q.rank);
    });

    it('puts a card of no length in front of a longer card starting with it', () => {
        const r = ranks([card('long', '09:00', '10:00'), card('point', '09:00', '09:00')]);
        expect(r.point).toBeGreaterThan(r.long);
    });

    it('settles two cards of no length at one time by the ID, whatever order they come in', () => {
        const forward = ranks([card('x', '09:00', '09:00'), card('y', '09:00', '09:00')]);
        const backward = ranks([card('y', '09:00', '09:00'), card('x', '09:00', '09:00')]);
        expect(forward).toEqual(backward);
    });

    it('ranks the day\'s cards 1 to their number with no rank twice', () => {
        const tasks = [
            card('a', '08:00', '08:05'),
            card('b', '08:05', '09:00'),
            card('c', '08:30', '08:40'),
            card('d', '08:35', '10:00'),
            card('e', '09:00', '09:00'),
            card('f', '11:00', '12:00'),
            card('g', '11:00', '11:30'),
            card('h', '11:10', '11:20'),
        ];
        const values = Object.values(ranks(tasks)).sort((x, y) => x - y);
        expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('ranks only the cards that are drawn', () => {
        const undrawn = { ...card('none', '08:00', '09:00'), drawn: null };
        const r = ranks([undrawn, card('a', '10:00', '11:00')]);
        expect(r).toEqual({ a: 1 });
    });

    describe('the gap to the card whose name band may hang over a card', () => {
        function gaps(tasks: DisplayTask[], lane: TimelineLane = UNLAID): Record<string, number | undefined> {
            const layout = TaskLayout.calculateTaskLayout(tasks, START_HOUR, lane);
            return Object.fromEntries([...layout].map(([id, slot]) => [id, slot.bandGap]));
        }

        // A band that would rise above the lane's first minute does not go
        // up, so the short cards of these scenes start near the lane's top
        // to hang their bands down over the cards after them.

        it('takes it from a short card shifted right in one cluster, over the first card of the next', () => {
            // L and A overlap, so A is shifted right; B starts as L ends,
            // 10px below A's top, and moves its content down from under the
            // band, so it overlaps neither and starts the next cluster.
            const g = gaps([card('L', '00:00', '00:25'), card('A', '00:15', '00:20'), card('B', '00:25', '02:00')]);
            expect(g.B).toBe(10);
        });

        it('takes it from a card of no length in front of a longer card starting with it', () => {
            const g = gaps([card('long', '17:00', '18:00'), card('point', '17:00', '17:00')]);
            expect(g.long).toBe(0);
            expect(g.point).toBeUndefined();
        });

        it('gives none to two long cards starting together, the one in front covering the other with its body', () => {
            const g = gaps([card('A', '19:00', '20:00'), card('B', '19:00', '19:30')]);
            expect(g).toEqual({ A: undefined, B: undefined });
        });

        it('takes the card that starts last where short cards follow one another', () => {
            // A and B, whose bands meet, are put side by side; both bands
            // hang over C's top, which moves its content down from under them.
            const lane = laneOf({ widthPx: WIDE, bandInsetPx: 20, narrowestSideBySidePx: 120 });
            const g = gaps([card('A', '00:00', '00:05'), card('B', '00:05', '00:10'), card('C', '00:10', '02:00')], lane);
            expect(g).toEqual({ A: undefined, B: undefined, C: 5 });
        });

        it('takes it from a short card in front of a short card after it', () => {
            // In a lane 40px wide C overlaps both and B is shifted right of
            // C: A spans 0 to 28px, B 12 to 40px. A's band, from 20px, lies
            // over B's band; B's band, from 32px, lies beside A, so A alone
            // stands in front, and B starts 10 minutes after it.
            const lane = laneOf({ widthPx: 40, bandInsetPx: 20 });
            const tasks = [card('A', '00:10', '00:15'), card('B', '00:20', '00:25'), card('C', '00:20', '00:50')];
            const layout = TaskLayout.calculateTaskLayout(tasks, START_HOUR, lane);
            expect(layout.get('A')!.rank).toBeGreaterThan(layout.get('B')!.rank);
            expect(gaps(tasks, lane)).toMatchObject({ A: undefined, B: 10 });
        });

        it('takes none from a card behind', () => {
            // Shifted, A and B lie over each other's bands, so each would
            // stand in front of the other; the two go round, and B, a level
            // higher, stands in front. M, after both, takes the gap to the
            // nearer of the two bands over its top, B's.
            const layout = TaskLayout.calculateTaskLayout(
                [card('A', '00:00', '00:05'), card('B', '00:05', '00:10'), card('M', '00:20', '02:00')],
                START_HOUR,
                UNLAID,
            );
            const a = layout.get('A')!;
            const b = layout.get('B')!;
            const m = layout.get('M')!;
            expect([a.band, b.band]).toEqual(['down', 'down']);
            expect([b.rank, a.rank, m.rank]).toEqual([3, 2, 1]);
            expect(b.bandGap).toBeUndefined();
            expect(a.bandGap).toBeUndefined();
            expect(m.bandGap).toBe(15);
        });

        it('takes none from a card whose band lies over it only under the band\'s notch', () => {
            // A is shifted right (15% to 100%); B is the first of four cards
            // that overlap, so it spans 0 to 55%. In a lane 40px wide A's band
            // starts at 6 + 20 = 26px and B ends at 22px; in one 400px wide
            // the band starts at 80px and B ends at 220px.
            const tasks = [
                card('L', '00:00', '00:25'), card('A', '00:15', '00:20'),
                card('B', '00:25', '02:00'), card('X', '00:30', '02:00'),
                card('Y', '00:35', '02:00'), card('Z', '00:40', '02:00'),
            ];
            expect(TaskLayout.calculateTaskLayout(tasks, START_HOUR, UNLAID).get('B')).toMatchObject({ left: 0, width: 55 });
            expect(gaps(tasks, laneOf({ widthPx: 40, bandInsetPx: 20 })).B).toBeUndefined();
            expect(gaps(tasks, laneOf({ widthPx: 400, bandInsetPx: 20 })).B).toBe(10);
        });

        it('takes it from a band further up where the nearest lies over the card only under its notch', () => {
            // D and E start with C and overlap it, so C spans 0 to 55% and
            // B, shifted right of A, 15% to 70%. In a lane 40px wide B's band
            // starts at 6 + 20 = 26px, right of C's end at 22px, and A's at
            // 20px; in one 400px wide B's band starts at 80px.
            const tasks = [
                card('A', '00:09', '00:14'), card('B', '00:14', '00:19'), card('C', '00:24', '01:54'),
                card('D', '00:24', '00:29'), card('E', '00:24', '00:29'),
            ];
            expect(TaskLayout.calculateTaskLayout(tasks, START_HOUR, UNLAID).get('C')).toMatchObject({ left: 0, width: 55 });
            expect(gaps(tasks, laneOf({ widthPx: 40, bandInsetPx: 20 })).C).toBe(15);
            expect(gaps(tasks, laneOf({ widthPx: 400, bandInsetPx: 20 })).C).toBe(10);
        });
    });
});

// A lane of 400px for its cards, so 4px of gap is 1% of it.
const WIDE = 400;

function slots(tasks: DisplayTask[], lane: TimelineLane = UNLAID): Record<string, LaneSlot> {
    return Object.fromEntries(TaskLayout.calculateTaskLayout(tasks, START_HOUR, lane));
}

function sideBySide(pxPerMinute: number, laneWidthPx: number, narrowestPx: number | null = 120): TimelineLane {
    return laneOf({ pxPerMinute, widthPx: laneWidthPx, narrowestSideBySidePx: narrowestPx });
}

function place(slot: LaneSlot): [number, number] {
    return [Number(slot.left.toFixed(3)), Number(slot.width.toFixed(3))];
}

interface Span {
    id: string;
    start: number;
    end: number;
}

/** A cluster of longer cards shifted right, each card with its level, and its levels' slot width and step, in % of the lane. */
interface ShiftedCluster {
    members: Span[];
    levels: Map<Span, number>;
    slotWidth: number;
    step: number;
}

/**
 * Longer cards shifted right, worked out here on their own by time, which
 * holds only where no card shows its name in a band: the cards joined by
 * overlapping times into clusters, each card's level one more than the
 * highest level of the cards before it that it overlaps, in start order,
 * the longer first.
 */
function shiftedByTime(items: Span[]): ShiftedCluster[] {
    const sorted = items.slice().sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const clusters: Span[][] = [];
    let clusterEnd = -1;
    for (const item of sorted) {
        if (clusters.length === 0 || item.start >= clusterEnd) {
            clusters.push([item]);
            clusterEnd = item.end;
        } else {
            clusters[clusters.length - 1].push(item);
            clusterEnd = Math.max(clusterEnd, item.end);
        }
    }
    return clusters.map(members => {
        const levels = new Map<Span, number>();
        members.forEach((card, i) => {
            let below = 0;
            for (let j = 0; j < i; j++) {
                const other = members[j];
                if (card.start < other.end && other.start < card.end) below = Math.max(below, levels.get(other)!);
            }
            levels.set(card, below + 1);
        });
        const maxLevel = Math.max(...levels.values());
        const slotWidth = Math.max(40, 100 - (maxLevel - 1) * 15);
        const step = maxLevel > 1 ? (100 - slotWidth) / (maxLevel - 1) : 0;
        return { members, levels, slotWidth, step };
    });
}

/**
 * `count` days of 2 to 6 cards starting from 09:00 to 11:55, each 5 to 240
 * minutes long, in a lane of one of `lanes` px at 0.5, 1 or 2px a minute;
 * the same days each run for one `seed`.
 */
function randomDays(seed: number, count: number, lanes: number[]): { lanePx: number; pxPerMinute: number; items: Span[] }[] {
    const random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: count }, () => {
        const lanePx = lanes[Math.floor(random() * lanes.length)];
        const pxPerMinute = [0.5, 1, 2][Math.floor(random() * 3)];
        const cards = 2 + Math.floor(random() * 5);
        const items = Array.from({ length: cards }, (_, i) => {
            const start = 9 * 60 + Math.floor(random() * 36) * 5;
            const end = start + 5 + Math.floor(random() * 48) * 5;
            return { id: `c${i}`, start, end };
        });
        return { lanePx, pxPerMinute, items };
    });
}

function cardsOf(items: Span[]): DisplayTask[] {
    const hhmm = (minutes: number) =>
        `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return items.map(it => card(it.id, hhmm(it.start), hhmm(it.end)));
}

describe('TaskLayout side by side', () => {
    const pair = () => [card('a', '10:00', '11:00'), card('b', '10:05', '11:00')];

    it('puts two cards starting 5 minutes apart in two columns where each is wide enough', () => {
        const r = slots(pair(), sideBySide(1, WIDE));
        // (400px - 4px) / 2 = 198px each, 49.5% of the lane.
        expect(place(r.a)).toEqual([0, 49.5]);
        expect(place(r.b)).toEqual([50.5, 49.5]);
        expect(r.a.liesOver).toBe(false);
        expect(r.b.liesOver).toBe(false);
        expect(r.b.rank).not.toBe(r.a.rank);
    });

    it('shifts the same two cards as before where a column would be too narrow', () => {
        // 200px for the cards: (200 - 4) / 2 = 98px < 120px.
        const r = slots(pair(), sideBySide(1, 200));
        expect(place(r.a)).toEqual([0, 85]);
        expect(place(r.b)).toEqual([15, 85]);
        expect(r.b.liesOver).toBe(true);
    });

    it('puts them side by side when a column is exactly the narrowest a card may be', () => {
        // 244px for the cards: (244 - 4) / 2 = 120px.
        expect(slots(pair(), sideBySide(1, 244)).b.liesOver).toBe(false);
        expect(slots(pair(), sideBySide(1, 243)).b.liesOver).toBe(true);
    });

    it('puts side by side a card starting below the name of the card it overlaps in time, with any width allowed or 120px', () => {
        // b starts 35px below a's top, below its 34.8px name row; their
        // times overlap, so the two are a cluster.
        for (const narrowestPx of [0, 120]) {
            const r = slots([card('a', '10:00', '11:00'), card('b', '10:35', '11:00')], sideBySide(1, WIDE, narrowestPx));
            expect(place(r.b)).toEqual([50.5, 49.5]);
            expect(r.b.liesOver).toBe(false);
        }
    });

    it('shifts all of three cards overlapping in time where three columns do not fit', () => {
        const tasks = () => [card('a', '10:00', '11:00'), card('b', '10:05', '11:00'), card('c', '10:10', '11:00')];
        // 300px: (300 - 8) / 3 = 97.3px < 120px. Two would fit, but none is put side by side.
        const narrow = slots(tasks(), sideBySide(1, 300));
        expect([narrow.a, narrow.b, narrow.c].map(place)).toEqual([[0, 70], [15, 70], [30, 70]]);
        // 400px: (400 - 8) / 3 = 130.7px.
        const wide = slots(tasks(), sideBySide(1, WIDE));
        expect([wide.a, wide.b, wide.c].map(s => s.liesOver)).toEqual([false, false, false]);
        expect(wide.a.left).toBe(0);
        expect(wide.c.left).toBeGreaterThan(wide.b.left);
        expect(wide.b.left).toBeGreaterThan(wide.a.left);
    });

    it('joins A and B, and B and C, into one cluster, giving it as many columns as cards overlap at once', () => {
        // A, a short card, overlaps B in time, and B overlaps C; C starts
        // after A ends, in A's column.
        const r = slots(
            [card('A', '10:00', '10:20'), card('B', '10:15', '11:00'), card('C', '10:30', '11:00')],
            sideBySide(1, WIDE),
        );
        expect(place(r.A)).toEqual([0, 49.5]);
        expect(place(r.B)).toEqual([50.5, 49.5]);
        expect(place(r.C)).toEqual([0, 49.5]);
        expect([r.A, r.B, r.C].every(s => !s.liesOver)).toBe(true);
    });

    it('never joins into a cluster two cards that do not overlap in time where the later moves its content down from under the band it starts on', () => {
        // short and next follow each other, next 5px below the top of
        // short's 22px band, which cannot go up at the lane's top; next has
        // room to move its content down under it. next and beside start 1px apart.
        const r = slots(
            [
                card('short', '00:00', '00:05'),
                card('next', '00:05', '01:30'),
                card('beside', '00:06', '01:30'),
            ],
            sideBySide(1, WIDE),
        );
        expect(r.short.band).toBe('down');
        expect(place(r.short)).toEqual([0, 100]);
        expect(place(r.next)).toEqual([0, 49.5]);
        expect(place(r.beside)).toEqual([50.5, 49.5]);
    });

    it('takes the gap to a name band from the places the cards end up in side by side', () => {
        // s spans the lane, its band going down from the lane's top and
        // from 220px to 400px across. Shifted, a spans 0 to 340px under the
        // band. Side by side, a spans 0 to 198px, clear of the band. b,
        // from 60px shifted and from 202px side by side, is under it
        // either way, and s stands in front of it, its band lying over it.
        const tasks = () => [card('s', '00:00', '00:05'), card('a', '00:05', '01:05'), card('b', '00:10', '01:05')];
        const gap = (narrowestPx: number | null) => {
            const lane = laneOf({ widthPx: WIDE, bandInsetPx: 220, narrowestSideBySidePx: narrowestPx });
            const layout = TaskLayout.calculateTaskLayout(tasks(), START_HOUR, lane);
            return { a: layout.get('a')!.bandGap, b: layout.get('b')!.bandGap };
        };
        expect(gap(null)).toEqual({ a: 5, b: 10 });
        expect(gap(120)).toEqual({ a: undefined, b: 10 });
    });

    it('puts a card of a cluster in the column of one that ended before it starts', () => {
        // A overlaps B in time, and B overlaps C; C starts after A ends.
        const r = slots(
            [card('A', '10:00', '10:30'), card('B', '10:10', '10:40'), card('C', '10:35', '11:00')],
            sideBySide(1, WIDE),
        );
        expect(place(r.A)).toEqual([0, 49.5]);
        expect(place(r.B)).toEqual([50.5, 49.5]);
        expect(place(r.C)).toEqual([0, 49.5]);
        expect([r.A, r.B, r.C].every(s => !s.liesOver)).toBe(true);
    });

    describe('over random days', () => {
        // Whether two cards' times overlap, and whether two cards lie clear
        // of each other across the lane.
        const timesMeet = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
        const apart = (r: Record<string, LaneSlot>, a: Span, b: Span) =>
            r[a.id].left + r[a.id].width <= r[b.id].left + 1e-9 || r[b.id].left + r[b.id].width <= r[a.id].left + 1e-9;
        const hasShort = (items: Span[], pxPerMinute: number) =>
            items.some(it => cardRange(it.start, it.end, pxPerMinute).short);

        it('never ends two cards overlapping in time at one place, whichever way they are laid out', () => {
            for (const narrowestPx of [0, 120, null]) {
                for (const { lanePx, pxPerMinute, items } of randomDays(20261121, 2000, [277, 322, 400, 600])) {
                    const r = slots(cardsOf(items), sideBySide(pxPerMinute, lanePx, narrowestPx));
                    const scene = JSON.stringify({ lanePx, pxPerMinute, narrowestPx, items });
                    for (const a of items) {
                        for (const b of items) {
                            if (a === b || !timesMeet(a, b)) continue;
                            const rightA = (r[a.id].left + r[a.id].width) * lanePx / 100;
                            const rightB = (r[b.id].left + r[b.id].width) * lanePx / 100;
                            expect(Math.abs(rightA - rightB), scene).toBeGreaterThan(0.01);
                        }
                    }
                }
            }
        });

        it('lays no two cards overlapping in time over each other across the lane with any width allowed', () => {
            // Six cards at most in a lane of 100px or more leave each column some width.
            for (const { lanePx, pxPerMinute, items } of randomDays(20261122, 2000, [100, 150, 200, 277, 361, 600])) {
                const r = slots(cardsOf(items), sideBySide(pxPerMinute, lanePx, 0));
                const scene = JSON.stringify({ lanePx, pxPerMinute, items });
                for (const a of items) {
                    expect(r[a.id].width, scene).toBeGreaterThan(0);
                    for (const b of items) {
                        if (a === b || !timesMeet(a, b)) continue;
                        expect(apart(r, a, b), scene).toBe(true);
                    }
                }
            }
        });

        it('lays a cluster out side by side, each card the narrowest or wider, or shifted right, each card one width, and never both', () => {
            for (const { lanePx, pxPerMinute, items } of randomDays(20261122, 2000, [277, 322, 400, 600])) {
                if (hasShort(items, pxPerMinute)) continue;
                const r = slots(cardsOf(items), sideBySide(pxPerMinute, lanePx));
                const scene = JSON.stringify({ lanePx, pxPerMinute, items });
                for (const { members } of shiftedByTime(items).filter(c => c.members.length > 1)) {
                    const side = members.every(a => r[a.id].width * lanePx / 100 >= 120 - 1e-6)
                        && members.every(a => members.every(b => a === b || !timesMeet(a, b) || apart(r, a, b)));
                    const shifted = members.every(a => Math.abs(r[a.id].width - r[members[0].id].width) < 1e-9);
                    expect(side || shifted, scene).toBe(true);
                }
            }
        });

        it('starts every card at its level\'s step and fills its level\'s slot where cards are shifted right', () => {
            for (const { lanePx, pxPerMinute, items } of randomDays(20261123, 2000, [277, 322, 400, 600])) {
                if (hasShort(items, pxPerMinute)) continue;
                const r = slots(cardsOf(items), sideBySide(pxPerMinute, lanePx, null));
                const scene = JSON.stringify({ lanePx, pxPerMinute, items });
                for (const { members, levels, slotWidth, step } of shiftedByTime(items)) {
                    for (const m of members) {
                        expect(r[m.id].left, scene).toBeCloseTo((levels.get(m)! - 1) * step, 9);
                        expect(r[m.id].width, scene).toBeCloseTo(slotWidth, 9);
                    }
                }
            }
        });

        it('lays a day out the same whatever order its cards come in', () => {
            let seed = 7;
            const random = () => {
                seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
                return seed / 0x80000000;
            };
            for (const narrowestPx of [null, 120, 0]) {
                for (const { lanePx, pxPerMinute, items } of randomDays(20261124, 1000, [277, 361, 600])) {
                    const lane = sideBySide(pxPerMinute, lanePx, narrowestPx);
                    const shuffled = items.slice();
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(random() * (i + 1));
                        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    expect(slots(cardsOf(shuffled), lane), JSON.stringify({ lanePx, pxPerMinute, narrowestPx, items }))
                        .toEqual(slots(cardsOf(items), lane));
                }
            }
        });
    });

    describe('with a narrowest of 0', () => {
        it('puts three cards starting together side by side in a lane too narrow for 120px', () => {
            const tasks = () => [card('a', '10:00', '11:00'), card('b', '10:00', '11:00'), card('c', '10:00', '11:00')];
            // A lane of a 7-day view, 150px: (150 - 8) / 3 = 47.3px each.
            expect(Object.values(slots(tasks(), sideBySide(1, 150))).map(s => s.liesOver).sort())
                .toEqual([false, true, true]);
            const r = slots(tasks(), sideBySide(1, 150, 0));
            expect([r.a, r.b, r.c].map(s => s.liesOver)).toEqual([false, false, false]);
            expect([r.a, r.b, r.c].map(s => s.width.toFixed(3))).toEqual(['31.556', '31.556', '31.556']);
        });

        it('shifts only a group whose columns would be narrower than nothing, keeping one exactly 0 side by side', () => {
            const at = (h: number, n: number) =>
                Array.from({ length: n }, (_, i) => card(`${h}-${i}`, `${h}:0${i}`, `${h}:30`));
            // 12px: four columns are (12 - 12) / 4 = 0px; five are (12 - 16) / 5 < 0.
            const r = slots([...at(10, 4), ...at(14, 5)], sideBySide(1, 12, 0));
            expect([0, 1, 2, 3].map(i => r[`10-${i}`].liesOver)).toEqual([false, false, false, false]);
            expect([1, 2, 3, 4].map(i => r[`14-${i}`].liesOver)).toEqual([true, true, true, true]);
        });
    });

    it('lays every day out as without side by side when the narrowest is never', () => {
        const days: DisplayTask[][] = [
            pair(),
            [card('a', '10:00', '11:00'), card('b', '10:05', '11:00'), card('c', '10:10', '11:00')],
            [card('long', '10:00', '13:00'), card('x', '10:40', '11:30'), card('y', '10:45', '11:30')],
            [card('Q', '20:00', '20:10'), card('P', '20:05', '21:00'), card('R', '20:10', '20:20')],
            [card('s', '23:26', '23:35'), card('n', '23:36', '23:59')],
            [card('p', '09:00', '09:00'), card('l', '09:00', '10:00'), card('m', '09:00', '09:30')],
        ];
        // The zoom decides which cards show a band and which way it goes,
        // so each lane is compared with one of no width at its own zoom.
        for (const tasks of days) {
            for (const [pxPerMinute, widthPx] of [[1, WIDE], [4, 1992]]) {
                const plain = slots(tasks, laneOf({ pxPerMinute }));
                expect(slots(tasks, sideBySide(pxPerMinute, widthPx, null))).toEqual(plain);
            }
        }
    });

    it('puts no cards side by side in a lane of no width, though any width would do', () => {
        const r = slots(pair(), sideBySide(1, 0, 0));
        expect(place(r.b)).toEqual([15, 85]);
        expect(r.b.liesOver).toBe(true);
    });
});

describe('TaskLayout with name bands going up or down', () => {
    // A lane of 322px for its cards (a column of 330px), 1px a minute, the
    // narrowest a card put side by side may be 120px, and a band's halo
    // starting 20px in from a card's left.
    const LANE = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: 120 });

    /** A day's cards from `id hh:mm-hh:mm` entries. */
    function day(entries: string): DisplayTask[] {
        return entries.split(',').map(entry => {
            const [id, span] = entry.trim().split(/\s+/);
            const [start, end] = span.split('-');
            return card(id, start, end);
        });
    }

    /** Each card's left and width in px of the lane, and its band's way, `-` for a card with no band. */
    function laid(entries: string, lane: TimelineLane = LANE): Record<string, [number, number, string]> {
        const layout = TaskLayout.calculateTaskLayout(day(entries), START_HOUR, lane);
        return Object.fromEntries([...layout].map(([id, slot]) => [id, [
            Number((slot.left * lane.widthPx / 100).toFixed(1)),
            Number((slot.width * lane.widthPx / 100).toFixed(1)),
            slot.band ?? '-',
        ]]));
    }

    /** The cards from the front to the back. */
    function front(entries: string, lane: TimelineLane = LANE): string[] {
        const layout = TaskLayout.calculateTaskLayout(day(entries), START_HOUR, lane);
        return [...layout].sort(([, a], [, b]) => b.rank - a.rank).map(([id]) => id);
    }

    function gapsOf(entries: string, lane: TimelineLane = LANE): Record<string, number | undefined> {
        const layout = TaskLayout.calculateTaskLayout(day(entries), START_HOUR, lane);
        return Object.fromEntries([...layout].map(([id, slot]) => [id, slot.bandGap]));
    }

    describe('places', () => {
        it('puts a short card up beside a long one it starts within, side by side, and the next down in the same column', () => {
            // g1 and g2 overlap C in time, not each other, so g2 takes g1's column.
            expect(laid('C 10:00-15:00, g1 10:30-10:35, g2 10:40-10:45')).toEqual({
                C: [0, 159, '-'], g1: [163, 159, 'up'], g2: [163, 159, 'down'],
            });
        });

        it('puts the first of two short cards 10 minutes apart up and both across the lane', () => {
            expect(laid('g1 10:30-10:35, g2 10:40-10:45')).toEqual({
                g1: [0, 322, 'up'], g2: [0, 322, 'down'],
            });
        });

        it('puts four short cards in a row side by side two by two, the bands of each pair meeting', () => {
            expect(laid('k1 10:30-10:35, k2 10:35-10:40, k3 10:40-10:45, k4 10:45-10:50, T 10:50-12:00')).toEqual({
                k1: [0, 159, 'up'], k2: [163, 159, 'up'],
                k3: [0, 159, 'down'], k4: [163, 159, 'down'],
                T: [0, 322, '-'],
            });
        });

        it('lays a short card whose band goes up clear of the name after it across the lane', () => {
            expect(laid('g 10:30-10:35, v 10:40-12:00')).toEqual({ g: [0, 322, 'up'], v: [0, 322, '-'] });
        });

        it('lays a short card right after a long one across the lane, its band down', () => {
            expect(laid('P 09:00-10:30, g 10:30-10:35')).toEqual({ P: [0, 322, '-'], g: [0, 322, 'down'] });
        });

        it('lays a short card between two long ones across the lane, its band up over the earlier\'s body', () => {
            expect(laid('P 09:00-10:30, g 10:30-10:35, v 10:35-12:00')).toEqual({
                P: [0, 322, '-'], g: [0, 322, 'up'], v: [0, 322, '-'],
            });
        });

        it('puts two short cards at one time side by side, their bands down', () => {
            expect(laid('a 11:00-11:05, b 11:00-11:05')).toEqual({
                a: [0, 159, 'down'], b: [163, 159, 'down'],
            });
        });

        it('lays short cards whose bands go each its own way clear of each other across the lane', () => {
            expect(laid('c 09:15-09:20, d 09:40-09:40, b 09:55-10:10, L 10:20-12:00')).toEqual({
                c: [0, 322, 'up'], d: [0, 322, 'up'], b: [0, 322, 'down'], L: [0, 322, '-'],
            });
        });

        it('puts side by side two short cards at the lane\'s top whose bands going down meet, though their times do not', () => {
            // Neither band can go up, so h's band hides g's; in one column
            // the two would hide each other's names.
            expect(laid('g 00:00-00:05, h 00:05-00:10, L 00:15-02:00')).toEqual({
                g: [0, 159, 'down'], h: [163, 159, 'down'], L: [0, 322, '-'],
            });
        });

        it('shifts right a short card at the lane\'s top whose band going down meets the one before, though their times do not, where cards are not put side by side', () => {
            const cascade = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: null });
            expect(laid('g 00:00-00:05, h 00:05-00:10, L 00:15-02:00', cascade)).toEqual({
                g: [0, 273.7, 'down'], h: [48.3, 273.7, 'down'], L: [0, 322, '-'],
            });
        });
    });

    describe('order', () => {
        it('puts a short card whose band goes up in front of the card before it, over whose body the band lies', () => {
            expect(front('P 09:00-10:30, g 10:30-10:35, v 10:35-12:00')).toEqual(['g', 'P', 'v']);
        });

        it('keeps a card shifted right in front of the card it overlaps in time', () => {
            expect(front('C 10:00-15:00, g1 10:30-10:35, g2 10:40-10:45')).toEqual(['g1', 'g2', 'C']);
        });

        it('takes two short cards side by side whose bands meet down the lane, neither lying over the other across, in start order', () => {
            // At the lane's top g and h's bands go down and meet, and each
            // lies beside the other card, so neither must stand in front of
            // the other; nor need they go behind the cards after them.
            expect(front('g 00:00-00:05, h 00:05-00:10, M 01:00-02:00, N 01:40-02:30')).toEqual(['g', 'h', 'N', 'M']);
        });

        it('takes two cards side by side starting together by their ends, the one ending first in front', () => {
            expect(laid('a 11:00-11:05, b 11:00-11:10')).toEqual({ a: [163, 159, 'down'], b: [0, 159, 'down'] });
            expect(front('a 11:00-11:05, b 11:00-11:10')).toEqual(['a', 'b']);
        });

        it('for now, puts the higher level in front where the cards that must stand in front of each other go round', () => {
            // Shifted right, k1 and k2 take the second level, k3 the third
            // and k4 the fourth, their bands lying over each other's.
            const lane = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: null });
            expect(laid('C 10:00-15:00, k1 10:30-10:35, k2 10:35-10:40, k3 10:40-10:45, k4 10:45-10:50', lane)).toEqual({
                C: [0, 177.1, '-'], k1: [48.3, 177.1, 'up'],
                k2: [48.3, 177.1, 'down'], k3: [96.6, 177.1, 'down'], k4: [144.9, 177.1, 'down'],
            });
            expect(front('C 10:00-15:00, k1 10:30-10:35, k2 10:35-10:40, k3 10:40-10:45, k4 10:45-10:50', lane))
                .toEqual(['k1', 'k4', 'k3', 'k2', 'C']);
        });

        it('keeps a card on no round behind the cards of a round whose bands lie over it, though its level is higher', () => {
            // At the lane's top g and h's bands go down, each over the other's
            // band, and both over M's top. M, shifted right of both, is on
            // the third level; nothing of M lies over g or h.
            expect(laid('g 00:00-00:05, h 00:05-00:10, M 00:10-00:40')).toEqual({
                g: [0, 225.4, 'down'], h: [48.3, 225.4, 'down'], M: [96.6, 225.4, '-'],
            });
            expect(front('g 00:00-00:05, h 00:05-00:10, M 00:10-00:40')).toEqual(['h', 'g', 'M']);
        });
    });

    describe('the gap to the band over a card\'s top', () => {
        it('takes it from the nearest of the bands going down above a card', () => {
            // k3 and k4 both end by T's start; k4 starts last.
            expect(gapsOf('k1 10:30-10:35, k2 10:35-10:40, k3 10:40-10:45, k4 10:45-10:50, T 10:50-12:00').T).toBe(5);
        });

        it('takes it from a band going down that ends above the card, as far as its halo reaches', () => {
            // b's band ends 3px above L's top, where its halo reaches, so
            // CSS moves nothing of L's content down.
            expect(gapsOf('c 09:15-09:20, d 09:40-09:40, b 09:55-10:10, L 10:20-12:00')).toEqual({
                c: undefined, d: undefined, b: undefined, L: 25,
            });
        });

        it('takes none from a band going up', () => {
            expect(gapsOf('g 10:30-10:35, v 10:40-12:00').v).toBeUndefined();
            expect(gapsOf('P 09:00-10:30, g 10:30-10:35, v 10:35-12:00').v).toBeUndefined();
        });

        it('takes none from a longer card, which has no band', () => {
            // P is 23px high, the lowest that shows its name inside.
            expect(gapsOf('P 10:00-10:26, n 10:26-11:00').n).toBeUndefined();
        });
    });
});

describe('TaskLayout right edges over a card behind', () => {
    const LANE = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: 120 });

    /** Whether each card's right edge, and its band's (`-` for a card with no band), lies over a card behind. */
    function marks(tasks: DisplayTask[], lane: TimelineLane = LANE): Record<string, [boolean, boolean | '-']> {
        const layout = TaskLayout.calculateTaskLayout(tasks, START_HOUR, lane);
        return Object.fromEntries([...layout].map(([id, slot]) => [id, [slot.rightLiesOver, slot.bandRightLiesOver ?? '-']]));
    }

    it('marks the right edge of a card of no length shifted right in front of one a level further right, and none side by side', () => {
        // Shifted right in three levels of 70%, D and C take the second
        // level, 48.3 to 273.7px, and B the third, 96.6 to 322px; D, of no
        // length, stands in front of B, which reaches right of D's right
        // edge. Side by side B is in a column of its own and D reaches the
        // lane's edge.
        const tasks = () => [
            card('A', '09:10', '09:45'), card('B', '09:25', '11:45'),
            card('C', '09:25', '12:25'), card('D', '09:25', '09:25'),
        ];
        const cascade = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: null });
        expect(marks(tasks(), cascade)).toEqual({ A: [false, '-'], B: [false, '-'], C: [false, '-'], D: [true, true] });
        const any = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: 0 });
        expect(marks(tasks(), any)).toEqual({ A: [false, '-'], B: [false, '-'], C: [false, '-'], D: [false, false] });
    });

    it('marks the band going down of the left of two short cards side by side, over the card after them, and not its body above that card', () => {
        // k3 and k4 hang their bands over T's top, k3's ending at 159px of T's 322px.
        expect(marks(day('k1 10:30-10:35, k2 10:35-10:40, k3 10:40-10:45, k4 10:45-10:50, T 10:50-12:00'))).toEqual({
            k1: [false, false], k2: [false, false],
            k3: [false, true], k4: [false, false],
            T: [false, '-'],
        });
    });

    it('marks no edge that ends where the card behind it ends', () => {
        // g's band rises over P's body, both spanning the lane.
        expect(marks(day('P 09:00-10:30, g 10:30-10:35, v 10:35-12:00')).g).toEqual([false, false]);
        // c2 spans the lane in front of c3, the last of three columns,
        // whose right edge comes to the lane's edge less a rounding.
        const zero = laneOf({ pxPerMinute: 2, widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: 0 });
        expect(marks(day('c0 09:10-10:45, c1 09:15-10:25, c2 09:10-09:10, c3 09:20-10:25'), zero).c2).toEqual([false, false]);
    });

    it('marks no right edge under the bands of cards in front, which lie over its top', () => {
        // In a lane of 150px, c4 spans 45 to 105px from 09:25. The bands of
        // c2 (0 to 127.5px) and c5 (22.5 to 150px), both from 09:05, reach
        // 2px down its top, so both stand in front of it; c0 and c6, which
        // overlap it in time, are shifted further right and stand in front
        // too. c1 and c3, behind it, end left of its right edge.
        const lane = laneOf({ widthPx: 150, bandInsetPx: 20, narrowestSideBySidePx: null });
        const layout = TaskLayout.calculateTaskLayout(
            day('c0 09:35-09:40, c1 09:05-10:10, c2 09:05-09:05, c3 09:10-10:25, c4 09:25-10:10, c5 09:05-09:05, c6 09:30-09:35'),
            START_HOUR,
            lane,
        );
        const c4 = layout.get('c4')!;
        expect(['c2', 'c5'].map(id => layout.get(id)!.band)).toEqual(['down', 'down']);
        expect(['c0', 'c2', 'c5', 'c6'].every(id => layout.get(id)!.rank > c4.rank)).toBe(true);
        expect(c4.rightLiesOver).toBe(false);
    });

    it('marks no edge over the notch left of the band of a card behind', () => {
        // In a lane of 150px at 0.67px a minute, c1 spans 0 to 60px, its
        // band rising beside the band of c0, which spans 45 to 105px and
        // rises from 65px, right of c1's edge.
        const lane = laneOf({ pxPerMinute: 0.67, widthPx: 150, bandInsetPx: 20, narrowestSideBySidePx: 120 });
        const r = marks(day('c0 09:25-09:35, c1 09:00-09:05, c2 09:10-11:05, c3 09:15-10:55, c4 09:30-09:35, c5 09:35-09:35'), lane);
        expect(r.c1).toEqual([false, false]);
    });

    /** A day's cards from `id hh:mm-hh:mm` entries. */
    function day(entries: string): DisplayTask[] {
        return entries.split(',').map(entry => {
            const [id, span] = entry.trim().split(/\s+/);
            const [start, end] = span.split('-');
            return card(id, start, end);
        });
    }
});

describe('TaskLayout halo past the left, top and bottom of a card over a card behind', () => {
    // At 1px a minute a card is drawn 3px shorter than its time, as far as
    // the halo reaches up and down; cards side by side stand 4px apart, as
    // far as it reaches left.
    const LANE = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: 120 });
    const CASCADE = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: null });

    function day(entries: string, lane: TimelineLane = LANE): Record<string, LaneSlot> {
        return slots(entries.split(',').map(entry => {
            const [id, span] = entry.trim().split(/\s+/);
            const [start, end] = span.split('-');
            return card(id, start, end);
        }), lane);
    }

    it('gives none to a card shifted right by bands alone with no card behind it', () => {
        // g's band and h's clash, and h's and M's, so M is shifted two
        // levels right; it overlaps no card in time and stands at the back.
        const r = day('g 00:00-00:05, h 00:05-00:10, M 00:10-00:40');
        expect(r.M.left).toBeGreaterThan(r.h.left);
        expect(r.M.rank).toBe(1);
        expect(r.M.liesOver).toBe(false);
        // h's body, 5 to 7px down and from 48.3px across, lies over g's band
        // going down, 0 to 22px from 20px.
        expect(r.h.rank).toBeGreaterThan(r.g.rank);
        expect(r.h.liesOver).toBe(true);
        expect(r.g.liesOver).toBe(false);
    });

    it('gives it to cards shifted right over a long card behind, and none to cards side by side alone', () => {
        // Three columns do not fit, so the three are shifted right: A spans
        // 48.3 to 273.7px over P's body, 0 to 225.4px, and B 96.6 to 322px
        // over both.
        const over = day('P 06:45-21:45, A 09:00-12:00, B 09:30-10:30');
        expect([over.P, over.A, over.B].map(s => s.liesOver)).toEqual([false, true, true]);
        // Alone, A spans 0 to 159px and B 163 to 322px: 4px apart, B's halo
        // reaches A's edge and shares nothing with it.
        const alone = day('A 09:00-12:00, B 09:30-10:30');
        expect(alone.B.left - (alone.A.left + alone.A.width)).toBeCloseTo(4 / 322 * 100);
        expect([alone.A, alone.B].map(s => s.liesOver)).toEqual([false, false]);
    });

    it('gives it to a card of no length over a long card behind', () => {
        // Z's body, 620 to 622px, lies over L's, 600 to 657px.
        const r = day('L 10:00-11:00, Z 10:20-10:20', CASCADE);
        expect(r.Z.rank).toBeGreaterThan(r.L.rank);
        expect(r.Z.liesOver).toBe(true);
        expect(r.L.liesOver).toBe(false);
    });

    it('gives it to a card whose time overlaps the one behind, though their bodies do not meet', () => {
        // A's body ends at 627px and B's starts at 628px: B's halo, from
        // 625px, comes 2px into A.
        const r = day('A 10:00-10:30, B 10:28-11:00', CASCADE);
        expect(r.B.rank).toBeGreaterThan(r.A.rank);
        expect(r.B.liesOver).toBe(true);
    });

    it('gives none to two cards one after the other, the halo reaching the next card\'s edge', () => {
        // A's body ends at 627px, B's starts at 630px.
        const r = day('A 10:00-10:30, B 10:30-11:00', CASCADE);
        expect([r.A, r.B].map(s => s.liesOver)).toEqual([false, false]);
    });
});

describe('narrowestSideBySidePx', () => {
    it('never puts cards side by side to cascade, where a card is legible for auto, and at any width side by side', () => {
        expect(narrowestSideBySidePx('cascade', 120)).toBeNull();
        expect(narrowestSideBySidePx('auto', 120)).toBe(120);
        expect(narrowestSideBySidePx('auto', 107.03125)).toBe(107.03125);
        expect(narrowestSideBySidePx('sideBySide', 120)).toBe(0);
    });

    // As 0 the width would put every cluster side by side however narrow.
    it('puts no cluster side by side for auto where the narrowest legible card is 0 or less', () => {
        expect(narrowestSideBySidePx('auto', 0)).toBeNull();
        expect(narrowestSideBySidePx('auto', -1)).toBeNull();
        expect(narrowestSideBySidePx('auto', Number.NaN)).toBeNull();
        expect(narrowestSideBySidePx('sideBySide', 0)).toBe(0);
        expect(narrowestSideBySidePx('cascade', 0)).toBeNull();
    });
});
