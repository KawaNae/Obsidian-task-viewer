import { describe, it, expect } from 'vitest';
import {
    markHandleSurface,
    resolveHandleSurface,
} from '../../../src/views/sharedUI/handles/HandleSurface';

/** A card is just its dataset as far as the surface marker is concerned. */
function makeCard(dataset: Record<string, string> = {}) {
    return { dataset } as unknown as HTMLElement;
}

describe('handle surface marker', () => {
    it('reads back what the renderer stamped', () => {
        const grid = makeCard();
        markHandleSurface(grid, 'grid');
        expect(resolveHandleSurface(grid)).toBe('grid');

        const timeline = makeCard();
        markHandleSurface(timeline, 'timeline');
        expect(resolveHandleSurface(timeline)).toBe('timeline');
    });

    it('is idempotent, so re-decorating a reused card is safe', () => {
        // CardReconciler hands the same element back across renders.
        const card = makeCard();
        markHandleSurface(card, 'grid');
        markHandleSurface(card, 'grid');
        expect(resolveHandleSurface(card)).toBe('grid');
    });

    it('lets a card change surface when it is re-parented', () => {
        const card = makeCard();
        markHandleSurface(card, 'timeline');
        markHandleSurface(card, 'grid');
        expect(resolveHandleSurface(card)).toBe('grid');
    });

    it('falls back to timeline for an unmarked card', () => {
        // Which is how an unmarked card resolved before the marker existed.
        expect(resolveHandleSurface(makeCard())).toBe('timeline');
    });

    it('falls back to timeline for a value it does not know', () => {
        expect(resolveHandleSurface(makeCard({ handleSurface: 'nonsense' }))).toBe('timeline');
    });
});
