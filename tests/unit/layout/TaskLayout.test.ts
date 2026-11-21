import { describe, it, expect } from 'vitest';
import { TaskLayout, narrowestSideBySidePx, type LaneGeometry, type LaneSlot, type SideBySideInput } from '../../../src/views/timelineview/TaskLayout';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { makeTask } from '../helpers/makeTask';
import type { DisplayTask } from '../../../src/types';
import { assignFirstFreeColumns } from '../../../src/views/sharedLogic/OverlapClusters';
import { SIDE_BY_SIDE_GAP_PX, nameRowHeightPx } from '../../../src/views/timelineview/TimedCardGeometry';

const START_HOUR = 0;

function at(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2026, 2, 11, h, m).getTime();
}

function card(id: string, start: string, end: string): DisplayTask {
    const task = toDisplayTask(makeTask({ id, content: id, startDate: '2026-03-11' }), START_HOUR, NO_TASK_LOOKUP);
    return { ...task, drawn: { startMs: at(start), endMs: at(end) } };
}

function ranks(tasks: DisplayTask[]): Record<string, number> {
    const layout = TaskLayout.calculateTaskLayout(tasks, START_HOUR);
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
        function gaps(tasks: DisplayTask[], lane?: LaneGeometry): Record<string, number | undefined> {
            const layout = TaskLayout.calculateTaskLayout(tasks, START_HOUR, lane);
            return Object.fromEntries([...layout].map(([id, slot]) => [id, slot.bandGap]));
        }

        it('takes it from a short card shifted right in one cluster, over the first card of the next', () => {
            // L and A overlap, so A is shifted right; B starts as both end.
            const g = gaps([card('L', '10:00', '11:05'), card('A', '11:00', '11:05'), card('B', '11:05', '12:00')]);
            expect(g.B).toBe(5);
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
            const g = gaps([card('A', '21:00', '21:05'), card('B', '21:05', '21:10'), card('C', '21:10', '22:00')]);
            expect(g).toEqual({ A: undefined, B: 5, C: 5 });
        });

        it('takes none from a card behind', () => {
            // K stands alone at level 1; N overlaps M and is shifted right, so
            // it stands in front of K although K ends before it starts.
            const g = gaps([card('K', '08:00', '08:05'), card('M', '08:10', '09:00'), card('N', '08:20', '08:50')]);
            expect(g.M).toBe(10);
            expect(g.N).toBeUndefined();
        });

        it('takes none from a card whose band lies over it only under the band\'s notch', () => {
            // A is shifted right (15% to 100%); B is the first of four cards
            // that overlap, so it spans 0 to 55%. In a lane 40px wide A's band
            // starts at 6 + 20 = 26px and B ends at 22px; in one 400px wide
            // the band starts at 80px and B ends at 220px.
            const tasks = [
                card('L', '10:00', '11:05'), card('A', '11:00', '11:05'),
                card('B', '11:05', '12:00'), card('X', '11:10', '12:00'),
                card('Y', '11:15', '12:00'), card('Z', '11:20', '12:00'),
            ];
            expect(TaskLayout.calculateTaskLayout(tasks, START_HOUR).get('B')).toMatchObject({ left: 0, width: 55 });
            expect(gaps(tasks, { width: 40, bandInset: 20 }).B).toBe(65);
            expect(gaps(tasks, { width: 400, bandInset: 20 }).B).toBe(5);
        });
    });
});

// A lane of 400px for its cards, so 3px of gap is 0.75% of it.
const WIDE = 400;

interface Input {
    lane: LaneGeometry;
    sideBySide: SideBySideInput;
}

function slots(tasks: DisplayTask[], input?: Input): Record<string, LaneSlot> {
    return Object.fromEntries(TaskLayout.calculateTaskLayout(tasks, START_HOUR, input?.lane, input?.sideBySide));
}

function sideBySide(pxPerMinute: number, laneWidthPx: number, minCardWidthPx: number | null = 120): Input {
    return {
        lane: { width: laneWidthPx, bandInset: 0 },
        sideBySide: { pxPerMinute, minCardWidthPx },
    };
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
 * The groups that hide each other's names, worked out here on their own,
 * each with the width of its level's slot, in % of the lane: the width every
 * card of its cluster has, the group taking one level as one card.
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
        // (400px - 3px) / 2 = 198.5px each, 49.625% of the lane.
        expect(place(r.a)).toEqual([0, 49.625]);
        expect(place(r.b)).toEqual([50.375, 49.625]);
        expect(r.a.liesOver).toBe(false);
        expect(r.b.liesOver).toBe(false);
        expect(r.b.rank).not.toBe(r.a.rank);
    });

    it('shifts the same two cards as before where a column would be too narrow', () => {
        // 200px for the cards: (200 - 3) / 2 = 98.5px < 120px.
        const r = slots(pair(), sideBySide(1, 200));
        expect(place(r.a)).toEqual([0, 85]);
        expect(place(r.b)).toEqual([15, 85]);
        expect(r.b.liesOver).toBe(true);
    });

    it('puts them side by side when a column is exactly the narrowest a card may be', () => {
        // 243px for the cards: (243 - 3) / 2 = 120px.
        expect(slots(pair(), sideBySide(1, 243)).b.liesOver).toBe(false);
        expect(slots(pair(), sideBySide(1, 242)).b.liesOver).toBe(true);
    });

    it('puts cards 15 minutes apart side by side at a small scale and shifts them at a large one', () => {
        const tasks = () => [card('a', '10:00', '11:00'), card('b', '10:15', '11:00')];
        // 15px is above the bottom of the 34.8px name row; 60px is below it.
        expect(place(slots(tasks(), sideBySide(1, WIDE)).b)).toEqual([50.375, 49.625]);
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
        // 300px: (300 - 6) / 3 = 98px < 120px. Two would fit, but none is put side by side.
        const narrow = slots(tasks(), sideBySide(1, 300));
        expect([narrow.a, narrow.b, narrow.c].map(place)).toEqual([[0, 70], [15, 70], [30, 70]]);
        // 400px: (400 - 6) / 3 = 131.3px.
        const wide = slots(tasks(), sideBySide(1, WIDE));
        expect([wide.a, wide.b, wide.c].map(s => s.liesOver)).toEqual([false, false, false]);
        expect(wide.a.left).toBe(0);
        expect(wide.c.left).toBeGreaterThan(wide.b.left);
        expect(wide.b.left).toBeGreaterThan(wide.a.left);
    });

    it('checks a group again when another group of its cluster is not put side by side', () => {
        // With both groups side by side the levels are two, 340px wide, and
        // long's group fits ((340 - 3) / 2 = 168.5px) where x's does not
        // ((340 - 6) / 3 = 111.3px). Laid out one by one, x's group makes
        // five levels, 160px wide, where long's no longer fits ((160 - 3) / 2).
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
        expect(place(r.A)).toEqual([0, 49.625]);
        expect(place(r.B)).toEqual([50.375, 49.625]);
        expect(place(r.C)).toEqual([0, 49.625]);
        expect([r.A, r.B, r.C].every(s => !s.liesOver)).toBe(true);
    });

    it('puts a group inside a long card on the second level, halved, tracing its outline', () => {
        const r = slots(
            [card('long', '10:00', '13:00'), card('x', '10:40', '11:30'), card('y', '10:45', '11:30')],
            sideBySide(1, WIDE),
        );
        expect(place(r.long)).toEqual([0, 85]);
        expect(r.long.liesOver).toBe(false);
        // (340px - 3px) / 2 = 168.5px each, 42.125% of the lane.
        expect(place(r.x)).toEqual([15, 42.125]);
        expect(place(r.y)).toEqual([57.875, 42.125]);
        expect(r.x.liesOver).toBe(true);
        expect(r.y.liesOver).toBe(true);
        expect(r.x.rank).toBeGreaterThan(r.long.rank);
        expect(r.y.rank).toBeGreaterThan(r.long.rank);
    });

    it('never groups two cards that do not overlap in time, though the later starts on the name', () => {
        // Inside long, short and next follow each other, next 5px below the
        // top of short's 22px band; next and beside start 1px apart.
        const r = slots(
            [
                card('long', '10:00', '11:00'),
                card('short', '10:40', '10:45'),
                card('next', '10:45', '11:00'),
                card('beside', '10:46', '11:00'),
            ],
            sideBySide(1, WIDE),
        );
        expect(place(r.short)).toEqual([15, 85]);
        expect(place(r.next)).toEqual([15, 42.125]);
        expect(place(r.beside)).toEqual([57.875, 42.125]);
    });

    it('takes the gap to a name band from the places the cards end up in side by side', () => {
        // s spans the lane, its band from 220px to 400px. Shifted, a spans 0
        // to 340px under the band and b, a level up, stands in front of s.
        // Side by side, a spans 0 to 198.5px, clear of the band, and b, from
        // 201.5px, shares s's level and stands behind it.
        const tasks = () => [card('s', '09:55', '10:00'), card('a', '10:00', '11:00'), card('b', '10:05', '11:00')];
        const lane = { width: WIDE, bandInset: 220 };
        const gap = (minCardWidthPx: number | null) => {
            const layout = TaskLayout.calculateTaskLayout(tasks(), START_HOUR, lane, { pxPerMinute: 1, minCardWidthPx });
            return { a: layout.get('a')!.bandGap, b: layout.get('b')!.bandGap };
        };
        expect(gap(null)).toEqual({ a: 5, b: undefined });
        expect(gap(120)).toEqual({ a: undefined, b: 10 });
    });

    it('puts three cards side by side as one group where each hides the next one\'s name, though the first and the last do not', () => {
        // At 2px a minute: A to B and B to C are 20px, above the 34.8px name
        // row; A to C is 40px, below it.
        const r = slots(
            [card('A', '10:00', '12:00'), card('B', '10:10', '12:00'), card('C', '10:20', '12:00')],
            sideBySide(2, WIDE),
        );
        // (400px - 6px) / 3 = 131.3px each, 32.833% of the lane.
        expect([r.A, r.B, r.C].map(place)).toEqual([[0, 32.833], [33.583, 32.833], [67.167, 32.833]]);
        expect([r.A, r.B, r.C].every(s => !s.liesOver)).toBe(true);
    });

    it('puts a card of a group in the column of one that ended before it starts', () => {
        // A and B are 10px apart, B and C 25px, both above the 26px name row
        // of a card of 30 minutes; C starts after A ends.
        const r = slots(
            [card('A', '10:00', '10:30'), card('B', '10:10', '10:40'), card('C', '10:35', '11:00')],
            sideBySide(1, WIDE),
        );
        expect(place(r.A)).toEqual([0, 49.625]);
        expect(place(r.B)).toEqual([50.375, 49.625]);
        expect(place(r.C)).toEqual([0, 49.625]);
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
            // p overlaps L, not s. (273.7 - 3) / 2 = 135.35px each.
            const r = slots(scene(), sideBySide(1, 322, 100));
            const [lLeft, lWidth] = px(r.L, 322);
            const [sLeft, sWidth] = px(r.s, 322);
            expect(lLeft).toBeCloseTo(0, 1);
            expect(lWidth).toBeCloseTo(135.35, 1);
            expect(sLeft).toBeCloseTo(138.35, 1);
            expect(sWidth).toBeCloseTo(135.35, 1);
            expect(place(r.p)).toEqual([15, 70]);
            expect(place(r.q)).toEqual([30, 70]);
        });

        it('puts a group side by side that its level\'s slot alone would leave too narrow', () => {
            // In 277px the first level's 70% would give (193.9 - 3) / 2 =
            // 95.45px; reaching to 85% gives (235.45 - 3) / 2 = 116.2px.
            const r = slots(scene(), sideBySide(1, 277, 100));
            expect(r.s.liesOver).toBe(false);
            expect(px(r.L, 277)[1]).toBeCloseTo(116.2, 1);
            expect(px(r.s, 277)[1]).toBeCloseTo(116.2, 1);
        });

        it('keeps pairs that each stop a step short of the pair in front where they were', () => {
            // Three pairs, each a level up and overlapping the last card of
            // the one before: each reaches a step short of the next, 70% of
            // the lane, (225.4 - 3) / 2 = 111.2px a column.
            const r = slots(
                [
                    card('a', '09:00', '09:50'), card('b', '09:00', '09:50'),
                    card('c', '09:45', '10:40'), card('d', '09:45', '10:40'),
                    card('e', '10:35', '11:30'), card('f', '10:35', '11:30'),
                ],
                sideBySide(1, 322, 100),
            );
            const lefts = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => px(r[id], 322)[0]);
            [0, 114.2, 48.3, 162.5, 96.6, 210.8].forEach((left, i) => expect(lefts[i]).toBeCloseTo(left, 1));
            for (const slot of Object.values(r)) expect(px(slot, 322)[1]).toBeCloseTo(111.2, 1);
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
            // (400px - 6px) / 3 = 131.3px each, where 85% would leave 111.3px.
            expect([r.a, r.b, r.c].map(place)).toEqual([[0, 32.833], [33.583, 32.833], [67.167, 32.833]]);
            expect(place(r.d)).toEqual([15, 85]);
        });

        it('stops a step short of a card in front overlapping its last column', () => {
            // c overlaps b, so the group ends at 85%, short of c's 100%.
            const r = slots(
                [card('a', '10:00', '11:00'), card('b', '10:05', '11:00'), card('c', '10:45', '12:00')],
                sideBySide(1, WIDE),
            );
            expect(place(r.a)).toEqual([0, 42.125]);
            expect(place(r.b)).toEqual([42.875, 42.125]);
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
            // (340px - 3px) / 2 = 168.5px; (340px - 6px) / 3 = 111.3px.
            expect([r.c, r.d].map(place)).toEqual([[15, 42.125], [57.875, 42.125]]);
            expect([r.a, r.b, r.b2].map(place)).toEqual([[0, 27.833], [28.583, 27.833], [57.167, 27.833]]);
            expect(place(r.e)).toEqual([30, 70]);
        });

        it('never ends two cards overlapping in time at one place, nor makes a column narrower than its level\'s slot split', () => {
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
            // A lane of a 7-day view, 150px: (150 - 6) / 3 = 48px each.
            expect(Object.values(slots(tasks(), sideBySide(1, 150))).map(s => s.liesOver).sort())
                .toEqual([false, true, true]);
            const r = slots(tasks(), sideBySide(1, 150, 0));
            expect([r.a, r.b, r.c].map(s => s.liesOver)).toEqual([false, false, false]);
            expect([r.a, r.b, r.c].map(s => s.width.toFixed(3))).toEqual(['32.000', '32.000', '32.000']);
        });

        it('shifts only a group whose columns would be narrower than nothing, keeping one exactly 0 side by side', () => {
            const at = (h: number, n: number) =>
                Array.from({ length: n }, (_, i) => card(`${h}-${i}`, `${h}:0${i}`, `${h}:30`));
            // 9px: four columns are (9 - 9) / 4 = 0px; five are (9 - 12) / 5 < 0.
            const r = slots([...at(10, 4), ...at(14, 5)], sideBySide(1, 9, 0));
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
        for (const tasks of days) {
            const plain = slots(tasks);
            for (const input of [sideBySide(1, WIDE, null), sideBySide(4, 1992, null)]) {
                expect(slots(tasks, input)).toEqual(plain);
            }
            for (const slot of Object.values(plain)) expect(slot.liesOver).toBe(slot.left > 0);
        }
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
