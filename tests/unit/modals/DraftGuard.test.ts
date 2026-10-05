import { describe, it, expect } from 'vitest';
import { DraftGuard, type Loss } from '../../../src/modals/form/DraftGuard';

/** A guard over a host that says what would be lost, and records what it was told. */
function guarded(initial: Loss | null = { kind: 'draft' }) {
    let loss: Loss | null = initial;
    const told = { renders: 0, asked: 0, goneOn: [] as string[] };
    const guard = new DraftGuard<'view' | 'close'>({
        loss: () => loss,
        render: () => { told.renders++; },
        asked: () => { told.asked++; },
        goOn: (after) => { told.goneOn.push(after); },
    });
    return { guard, told, setLoss: (next: Loss | null) => { loss = next; } };
}

describe('DraftGuard', () => {
    it('lets a step go on when nothing would be lost, asking nothing', () => {
        const h = guarded(null);
        expect(h.guard.request('close')).toBe(true);
        expect(h.guard.asking).toBeNull();
        expect(h.told).toEqual({ renders: 0, asked: 0, goneOn: [] });
    });

    it('asks before a step that would lose something, and goes on to it once thrown away', () => {
        const h = guarded();
        expect(h.guard.request('view')).toBe(false);
        expect(h.guard.asking).toEqual({ kind: 'draft' });
        expect(h.told).toMatchObject({ renders: 1, asked: 1 });
        h.guard.discard();
        expect(h.guard.asking).toBeNull();
        expect(h.told.goneOn).toEqual(['view']);
    });

    it('asked again while it asks, puts the question again without drawing it again, and goes on to the step asked last', () => {
        const h = guarded();
        h.guard.request('view');
        // Nothing would be lost now, but the question stands until it is answered.
        h.setLoss(null);
        expect(h.guard.request('close')).toBe(false);
        expect(h.told).toMatchObject({ renders: 1, asked: 2 });
        h.guard.discard();
        expect(h.told.goneOn).toEqual(['close']);
    });

    it('draws the question again when what would be lost changed', () => {
        const h = guarded({ kind: 'unsaved', fields: ['開始の日付'] });
        h.guard.request('close');
        h.setLoss({ kind: 'unsaved', fields: ['開始の日付', '線種'] });
        h.guard.request('close');
        expect(h.guard.asking).toEqual({ kind: 'unsaved', fields: ['開始の日付', '線種'] });
        expect(h.told.renders).toBe(2);
    });

    it('keeping, or acting on what would be lost, withdraws the question and goes nowhere', () => {
        const h = guarded();
        h.guard.request('close');
        expect(h.guard.keep()).toBe(true);
        expect(h.guard.asking).toBeNull();
        expect(h.guard.keep()).toBe(false);
        h.guard.request('close');
        expect(h.guard.withdraw()).toBe(true);
        expect(h.guard.withdraw()).toBe(false);
        // Thrown away with nothing asked: nothing to go on to.
        h.guard.discard();
        expect(h.told.goneOn).toEqual([]);
    });
});
