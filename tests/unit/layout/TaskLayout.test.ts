import { describe, it, expect } from 'vitest';
import { TaskLayout, type LaneGeometry, type LaneSlot, type SideBySideInput } from '../../../src/views/timelineview/TaskLayout';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { makeTask } from '../helpers/makeTask';
import type { DisplayTask } from '../../../src/types';

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
