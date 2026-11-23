import { describe, it, expect } from 'vitest';
import { legibleCardPx } from '../../../../src/views/timelineview/LegibleCardWidth';

/**
 * The narrowest legible card from the lengths read off a card in the
 * column. Reading them takes a DOM laid out by a stylesheet, which this
 * suite has not; the lengths below are those of the default stylesheet on
 * the desktop: start and end 67.03125px, the time row 6px in from each
 * side, the name's box 38px in from the left and 2px from the right.
 */
describe('legibleCardPx', () => {
    it('adds to the times the wider of the time row\'s sides and the name box\'s', () => {
        expect(legibleCardPx({ timeUnitsPx: 67.03125, timeRowSidesPx: 12, nameBoxSidesPx: 40 })).toBe(107.03125);
        // A stylesheet that put the name's box further out than the time row
        // would still have the times whole.
        expect(legibleCardPx({ timeUnitsPx: 67.03125, timeRowSidesPx: 12, nameBoxSidesPx: 8 })).toBe(79.03125);
    });

    it('is 0 where the times were not laid out, whatever the sides', () => {
        expect(legibleCardPx({ timeUnitsPx: 0, timeRowSidesPx: 12, nameBoxSidesPx: 40 })).toBe(0);
        expect(legibleCardPx({ timeUnitsPx: Number.NaN, timeRowSidesPx: 12, nameBoxSidesPx: 40 })).toBe(0);
    });
});
