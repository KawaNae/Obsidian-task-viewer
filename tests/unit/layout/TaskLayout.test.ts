import { describe, it, expect } from 'vitest';
import { TaskLayout } from '../../../src/views/timelineview/TaskLayout';
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
});
