import { describe, it, expect } from 'vitest';
import { TaskLayout, narrowestSideBySidePx, type LaneSlot, type TimelineLane } from '../../../src/views/timelineview/TaskLayout';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { makeTask } from '../helpers/makeTask';
import type { DisplayTask } from '../../../src/types';
import { assignFirstFreeColumns } from '../../../src/views/sharedLogic/OverlapClusters';
import { SIDE_BY_SIDE_GAP_PX, nameRowHeightPx } from '../../../src/views/timelineview/TimedCardGeometry';
import { cardRange } from '../../../src/views/timelineview/CardRanges';

const START_HOUR = 0;

/** A lane not laid out yet: no width, so no cards are put side by side. */
const UNLAID: TimelineLane = {
    pxPerMinute: 1,
    widthPx: 0,
    bandInsetPx: 0,
    bandHaloBlockPx: 3,
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

        it('takes none from a card behind', () => {
            // Shifted, A and B lie over each other's bands, so each band
            // would stand in front of the other card and either may; B takes
            // the gap to A's band only where A stands in front of it.
            const layout = TaskLayout.calculateTaskLayout(
                [card('A', '00:00', '00:05'), card('B', '00:05', '00:10')],
                START_HOUR,
                UNLAID,
            );
            const a = layout.get('A')!;
            const b = layout.get('B')!;
            expect([a.band, b.band]).toEqual(['down', 'down']);
            expect(b.bandGap).toBe(a.rank > b.rank ? 5 : undefined);
            expect(a.bandGap).toBeUndefined();
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

/**
 * The groups of longer cards that hide each other's names, worked out here
 * on their own by time, each with the width of its level's slot, in % of the
 * lane: the width every card of its cluster has, the group taking one level
 * as one card. Cards with no band overlap only by time.
 */
function slotsSplitByLevel(items: Span[], pxPerMinute: number): { members: Span[]; slotPercent: number }[] {
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
    const out: { members: Span[]; slotPercent: number }[] = [];
    for (const cluster of clusters) {
        const root = cluster.map((_, i) => i);
        const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
        cluster.forEach((earlier, i) => {
            for (let j = i + 1; j < cluster.length; j++) {
                const later = cluster[j];
                if (later.start >= earlier.end) continue;
                if ((later.start - earlier.start) * pxPerMinute >= nameRowHeightPx(earlier.end - earlier.start, pxPerMinute)) continue;
                root[find(j)] = find(i);
            }
        });
        const byRoot = new Map<number, Span[]>();
        cluster.forEach((item, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), item]));
        const units = [...byRoot.values()]
            .map(members => ({ members, start: members[0].start, end: Math.max(...members.map(m => m.end)) }))
            .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
        const levels: number[] = [];
        units.forEach((unit, i) => {
            let below = 0;
            for (let j = 0; j < i; j++) {
                if (unit.start < units[j].end && unit.end > units[j].start) below = Math.max(below, levels[j]);
            }
            levels.push(below + 1);
        });
        const slotPercent = Math.max(40, 100 - (Math.max(...levels) - 1) * 15);
        for (const unit of units) if (unit.members.length > 1) out.push({ members: unit.members, slotPercent });
    }
    return out;
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

    it('puts cards 15 minutes apart side by side at a small scale and shifts them at a large one', () => {
        const tasks = () => [card('a', '10:00', '11:00'), card('b', '10:15', '11:00')];
        // 15px is above the bottom of the 34.8px name row; 60px is below it.
        expect(place(slots(tasks(), sideBySide(1, WIDE)).b)).toEqual([50.5, 49.5]);
        expect(place(slots(tasks(), sideBySide(4, WIDE)).b)).toEqual([15, 85]);
    });

    it('takes the name row of a card with a time row as 34.8px', () => {
        // 60 minutes at 1px: 57px high, with a time row.
        const at34 = slots([card('a', '10:00', '11:00'), card('b', '10:34', '11:00')], sideBySide(1, WIDE));
        const at35 = slots([card('a', '10:00', '11:00'), card('b', '10:35', '11:00')], sideBySide(1, WIDE));
        expect(at34.b.liesOver).toBe(false);
        expect(at35.b.liesOver).toBe(true);
    });

    it('takes the name row of a card with no time row as 26px', () => {
        // 30 minutes at 1px: 27px high, no time row.
        const at25 = slots([card('a', '10:00', '10:30'), card('b', '10:25', '10:40')], sideBySide(1, WIDE));
        const at26 = slots([card('a', '10:00', '10:30'), card('b', '10:26', '10:40')], sideBySide(1, WIDE));
        expect(at25.b.liesOver).toBe(false);
        expect(at26.b.liesOver).toBe(true);
        // 35 minutes at 1px: 32px high, the highest with no time row.
        const at32 = slots([card('a', '10:00', '10:35'), card('b', '10:26', '10:40')], sideBySide(1, WIDE));
        expect(at32.b.liesOver).toBe(true);
    });

    it('takes the name row of a card with a name band as 22px, and a card starting at its bottom as clear of it', () => {
        // 12 minutes at 2px: 21px high, a band of 22px.
        const at20 = slots([card('a', '10:00', '10:12'), card('b', '10:10', '10:40')], sideBySide(2, WIDE));
        const at22 = slots([card('a', '10:00', '10:12'), card('b', '10:11', '10:40')], sideBySide(2, WIDE));
        expect(at20.b.liesOver).toBe(false);
        expect(at22.b.liesOver).toBe(true);
    });

    it('shifts all of three cards that hide each other\'s names where three columns do not fit', () => {
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

    it('checks a group again when another group of its cluster is not put side by side', () => {
        // With both groups side by side the levels are two, 340px wide, and
        // long's group fits ((340 - 4) / 2 = 168px) where x's does not
        // ((340 - 8) / 3 = 110.7px). Laid out one by one, x's group makes
        // five levels, 160px wide, where long's no longer fits ((160 - 4) / 2).
        const r = slots(
            [
                card('long', '10:00', '13:00'),
                card('long2', '10:05', '13:00'),
                card('x', '11:00', '11:30'),
                card('y', '11:05', '11:30'),
                card('z', '11:10', '11:30'),
            ],
            sideBySide(1, WIDE),
        );
        expect([r.long, r.long2, r.x, r.y, r.z].map(place))
            .toEqual([[0, 40], [15, 40], [30, 40], [45, 40], [60, 40]]);
    });

    it('joins A and B, and B and C, into one group, giving it as many columns as cards overlap at once', () => {
        // A (a band) and B, 15px apart; B and C, 15px apart; C starts after A ends.
        const r = slots(
            [card('A', '10:00', '10:20'), card('B', '10:15', '11:00'), card('C', '10:30', '11:00')],
            sideBySide(1, WIDE),
        );
        expect(place(r.A)).toEqual([0, 49.5]);
        expect(place(r.B)).toEqual([50.5, 49.5]);
        expect(place(r.C)).toEqual([0, 49.5]);
        expect([r.A, r.B, r.C].every(s => !s.liesOver)).toBe(true);
    });

    it('puts a group inside a long card on the second level, halved, tracing its outline', () => {
        const r = slots(
            [card('long', '10:00', '13:00'), card('x', '10:40', '11:30'), card('y', '10:45', '11:30')],
            sideBySide(1, WIDE),
        );
        expect(place(r.long)).toEqual([0, 85]);
        expect(r.long.liesOver).toBe(false);
        // (340px - 4px) / 2 = 168px each, 42% of the lane.
        expect(place(r.x)).toEqual([15, 42]);
        expect(place(r.y)).toEqual([58, 42]);
        expect(r.x.liesOver).toBe(true);
        expect(r.y.liesOver).toBe(true);
        expect(r.x.rank).toBeGreaterThan(r.long.rank);
        expect(r.y.rank).toBeGreaterThan(r.long.rank);
    });

    it('never groups two cards that do not overlap in time where the later moves its content down from under the band it starts on', () => {
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

    it('puts three cards side by side as one group where each hides the next one\'s name, though the first and the last do not', () => {
        // At 2px a minute: A to B and B to C are 20px, above the 34.8px name
        // row; A to C is 40px, below it.
        const r = slots(
            [card('A', '10:00', '12:00'), card('B', '10:10', '12:00'), card('C', '10:20', '12:00')],
            sideBySide(2, WIDE),
        );
        // (400px - 8px) / 3 = 130.7px each, 32.667% of the lane.
        expect([r.A, r.B, r.C].map(place)).toEqual([[0, 32.667], [33.667, 32.667], [67.333, 32.667]]);
        expect([r.A, r.B, r.C].every(s => !s.liesOver)).toBe(true);
    });

    it('puts a card of a group in the column of one that ended before it starts', () => {
        // A and B are 10px apart, B and C 25px, both above the 26px name row
        // of a card of 30 minutes; C starts after A ends.
        const r = slots(
            [card('A', '10:00', '10:30'), card('B', '10:10', '10:40'), card('C', '10:35', '11:00')],
            sideBySide(1, WIDE),
        );
        expect(place(r.A)).toEqual([0, 49.5]);
        expect(place(r.B)).toEqual([50.5, 49.5]);
        expect(place(r.C)).toEqual([0, 49.5]);
        expect([r.A, r.B, r.C].every(s => !s.liesOver)).toBe(true);
    });

    describe('the span a group reaches right to', () => {
        // A lane of 322px: one card long behind a short one 30 minutes later,
        // and two cards further on, each a level up.
        const scene = () => [
            card('L', '07:15', '16:07'),
            card('s', '07:45', '07:50'),
            card('p', '09:30', '12:50'),
            card('q', '10:45', '12:30'),
        ];
        const px = (slot: LaneSlot, lanePx: number) => [slot.left * lanePx / 100, slot.width * lanePx / 100];

        it('reaches as far as its last column would as a level of its own, a card in front overlapping only its first column not stopping it', () => {
            // Three levels of 70%, a step of 15%. L and s take the first level
            // and reach where s would end as the second, 85% (273.7px);
            // p overlaps L, not s. (273.7 - 4) / 2 = 134.85px each.
            const r = slots(scene(), sideBySide(1, 322, 100));
            const [lLeft, lWidth] = px(r.L, 322);
            const [sLeft, sWidth] = px(r.s, 322);
            expect(lLeft).toBeCloseTo(0, 1);
            expect(lWidth).toBeCloseTo(134.85, 1);
            expect(sLeft).toBeCloseTo(138.85, 1);
            expect(sWidth).toBeCloseTo(134.85, 1);
            expect(place(r.p)).toEqual([15, 70]);
            expect(place(r.q)).toEqual([30, 70]);
        });

        it('puts a group side by side that its level\'s slot alone would leave too narrow', () => {
            // In 277px the first level's 70% would give (193.9 - 4) / 2 =
            // 94.95px; reaching to 85% gives (235.45 - 4) / 2 = 115.7px.
            const r = slots(scene(), sideBySide(1, 277, 100));
            expect(r.s.liesOver).toBe(false);
            expect(px(r.L, 277)[1]).toBeCloseTo(115.7, 1);
            expect(px(r.s, 277)[1]).toBeCloseTo(115.7, 1);
        });

        it('keeps pairs that each stop a step short of the pair in front where they were', () => {
            // Three pairs, each a level up and overlapping the last card of
            // the one before: each reaches a step short of the next, 70% of
            // the lane, (225.4 - 4) / 2 = 110.7px a column.
            const r = slots(
                [
                    card('a', '09:00', '09:50'), card('b', '09:00', '09:50'),
                    card('c', '09:45', '10:40'), card('d', '09:45', '10:40'),
                    card('e', '10:35', '11:30'), card('f', '10:35', '11:30'),
                ],
                sideBySide(1, 322, 100),
            );
            const lefts = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => px(r[id], 322)[0]);
            [0, 114.7, 48.3, 163, 96.6, 211.3].forEach((left, i) => expect(lefts[i]).toBeCloseTo(left, 1));
            for (const slot of Object.values(r)) expect(px(slot, 322)[1]).toBeCloseTo(110.7, 1);
        });

        it('stops at the lane\'s edge', () => {
            // At 2px a minute a, b and c hide each other's names; d does not,
            // and overlaps a and b but not c. Two levels of 85%: the group's
            // third column as a level of its own would end at 115%.
            const r = slots(
                [
                    card('a', '10:00', '12:00'),
                    card('b', '10:05', '12:00'),
                    card('c', '10:10', '10:20'),
                    card('d', '10:30', '12:00'),
                ],
                sideBySide(2, WIDE),
            );
            // (400px - 8px) / 3 = 130.7px each, where 85% would leave 110.7px.
            expect([r.a, r.b, r.c].map(place)).toEqual([[0, 32.667], [33.667, 32.667], [67.333, 32.667]]);
            expect(place(r.d)).toEqual([15, 85]);
        });

        it('stops a step short of a card in front overlapping its last column', () => {
            // c overlaps b, so the group ends at 85%, short of c's 100%.
            const r = slots(
                [card('a', '10:00', '11:00'), card('b', '10:05', '11:00'), card('c', '10:45', '12:00')],
                sideBySide(1, WIDE),
            );
            expect(place(r.a)).toEqual([0, 42]);
            expect(place(r.b)).toEqual([43, 42]);
            expect(place(r.c)).toEqual([15, 85]);
        });

        it('stops a step short of the right edge a group in front reaches to', () => {
            // Three levels of 70%. c and d reach to 100%, e overlapping only
            // c; a, b and b2 stop a step short of it, at 85%, where c and
            // d's slot alone would stop them at 70%.
            const r = slots(
                [
                    card('a', '10:00', '11:00'),
                    card('b', '10:05', '11:00'),
                    card('b2', '10:10', '11:00'),
                    card('c', '10:50', '12:00'),
                    card('d', '10:55', '11:10'),
                    card('e', '11:30', '12:30'),
                ],
                sideBySide(1, WIDE, 100),
            );
            // (340px - 4px) / 2 = 168px; (340px - 8px) / 3 = 110.7px.
            expect([r.c, r.d].map(place)).toEqual([[15, 42], [58, 42]]);
            expect([r.a, r.b, r.b2].map(place)).toEqual([[0, 27.667], [28.667, 27.667], [57.333, 27.667]]);
            expect(place(r.e)).toEqual([30, 70]);
        });

        it('never ends two cards overlapping in time at one place, nor makes a column of longer cards narrower than its level\'s slot split', () => {
            let seed = 20261121;
            const random = () => {
                seed = (seed + 0x6d2b79f5) | 0;
                let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
            const hhmm = (minutes: number) =>
                `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
            for (let n = 0; n < 2000; n++) {
                const lanePx = [277, 322, 400][Math.floor(random() * 3)];
                const pxPerMinute = [0.5, 1, 2][Math.floor(random() * 3)];
                const count = 2 + Math.floor(random() * 5);
                const items = Array.from({ length: count }, (_, i) => {
                    const start = 9 * 60 + Math.floor(random() * 36) * 5;
                    const end = start + 5 + Math.floor(random() * 48) * 5;
                    return { id: `c${i}`, start, end };
                });
                const tasks = items.map(it => card(it.id, hhmm(it.start), hhmm(it.end)));
                const r = slots(tasks, sideBySide(pxPerMinute, lanePx, 0));
                const scene = JSON.stringify({ lanePx, pxPerMinute, items });
                for (const a of items) {
                    for (const b of items) {
                        if (a === b || !(a.start < b.end && b.start < a.end)) continue;
                        const rightA = (r[a.id].left + r[a.id].width) * lanePx / 100;
                        const rightB = (r[b.id].left + r[b.id].width) * lanePx / 100;
                        expect(Math.abs(rightA - rightB), scene).toBeGreaterThan(0.01);
                    }
                }
                // The groups are worked out here by time alone, which holds
                // only where no card shows its name in a band.
                if (items.some(it => cardRange(it.start, it.end, pxPerMinute).short)) continue;
                for (const { members, slotPercent } of slotsSplitByLevel(items, pxPerMinute)) {
                    const { columnCount } = assignFirstFreeColumns(members, m => m.start, m => m.end);
                    const split = (slotPercent / 100 * lanePx - (columnCount - 1) * SIDE_BY_SIDE_GAP_PX) / columnCount;
                    for (const m of members) {
                        expect(r[m.id].width * lanePx / 100, scene).toBeGreaterThanOrEqual(split - 1e-6);
                    }
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

        it('shifts a card starting below the name row of the card it overlaps', () => {
            const r = slots([card('a', '10:00', '11:00'), card('b', '10:35', '11:00')], sideBySide(1, WIDE, 0));
            expect(place(r.b)).toEqual([15, 85]);
            expect(r.b.liesOver).toBe(true);
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
                for (const slot of Object.values(plain)) expect(slot.liesOver).toBe(slot.left > 0);
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
        it('puts a short card up beside a long one it starts within, side by side, and the next down shifted', () => {
            expect(laid('C 10:00-15:00, g1 10:30-10:35, g2 10:40-10:45')).toEqual({
                C: [0, 159, '-'], g1: [163, 159, 'up'], g2: [48.3, 273.7, 'down'],
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

        it('puts side by side two longer cards whose names lie at one height, and not two whose names do not', () => {
            // At 2px a minute b starts 30px below a's top, on its 34.8px
            // name row; c starts 40px below it.
            const at2 = laneOf({ pxPerMinute: 2, widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: 120 });
            expect(laid('a 10:00-12:00, b 10:15-12:00', at2)).toEqual({ a: [0, 159, '-'], b: [163, 159, '-'] });
            expect(laid('a 10:00-12:00, c 10:20-12:00', at2)).toEqual({ a: [0, 273.7, '-'], c: [48.3, 273.7, '-'] });
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

        it('for now, puts the higher level in front where the cards that must stand in front of each other go round', () => {
            // k1 shares C's level, side by side; k2 to k4 are shifted a level
            // each, their bands lying over each other and over k1's.
            const lane = laneOf({ widthPx: 322, bandInsetPx: 20, narrowestSideBySidePx: 100 });
            expect(laid('C 10:00-15:00, k1 10:30-10:35, k2 10:35-10:40, k3 10:40-10:45, k4 10:45-10:50', lane)).toEqual({
                C: [0, 110.7, '-'], k1: [114.7, 110.7, 'up'],
                k2: [48.3, 177.1, 'down'], k3: [96.6, 177.1, 'down'], k4: [144.9, 177.1, 'down'],
            });
            expect(front('C 10:00-15:00, k1 10:30-10:35, k2 10:35-10:40, k3 10:40-10:45, k4 10:45-10:50', lane))
                .toEqual(['k1', 'k4', 'k3', 'k2', 'C']);
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

describe('narrowestSideBySidePx', () => {
    it('never puts cards side by side to cascade, at the threshold for auto, and at any width side by side', () => {
        expect(narrowestSideBySidePx('cascade', 120)).toBeNull();
        expect(narrowestSideBySidePx('auto', 120)).toBe(120);
        expect(narrowestSideBySidePx('auto', 80)).toBe(80);
        expect(narrowestSideBySidePx('sideBySide', 120)).toBe(0);
    });
});
