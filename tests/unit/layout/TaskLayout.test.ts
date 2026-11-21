import { describe, it, expect } from 'vitest';
import { TaskLayout, type LaneGeometry } from '../../../src/views/timelineview/TaskLayout';
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
