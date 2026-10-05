import { describe, it, expect } from 'vitest';
import { foldsAt } from '../../../src/views/sharedUI/ToolbarFold';

describe('foldsAt', () => {
    it('folds when the row needs more than the toolbar has', () => {
        expect(foldsAt(560, 570, false)).toBe(true);
        expect(foldsAt(400, 570, false)).toBe(true);
    });

    it('stays open when the row fits, to the pixel', () => {
        expect(foldsAt(700, 570, false)).toBe(false);
        expect(foldsAt(570, 570, false)).toBe(false);
    });

    it('decides from the width needed open alone, folded or not', () => {
        // Folding frees room; the width needed open is what is compared, so a
        // folded toolbar does not unfold until the open row fits.
        expect(foldsAt(560, 570, true)).toBe(true);
        expect(foldsAt(700, 570, true)).toBe(false);
    });

    it('keeps the fold it has out of sight (no width)', () => {
        expect(foldsAt(0, 570, true)).toBe(true);
        expect(foldsAt(0, 570, false)).toBe(false);
    });

    it('keeps the fold it has until the width needed is measured', () => {
        expect(foldsAt(400, null, false)).toBe(false);
        expect(foldsAt(700, null, true)).toBe(true);
    });
});
