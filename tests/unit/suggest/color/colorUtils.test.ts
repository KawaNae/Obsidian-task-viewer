import { describe, it, expect } from 'vitest';
import { filterColors } from '../../../../src/suggest/color/colorUtils';

describe('filterColors', () => {
    it('puts the prefix match "blue" ahead of the substring match "aliceblue"', () => {
        const result = filterColors('blu');
        expect(result.indexOf('blue')).toBeLessThan(result.indexOf('aliceblue'));
        // Both "blue" and "blueviolet" are prefix matches; CSS_COLORS lists
        // "blue" first, and same-rank ties keep that order (stable sort).
        expect(result.slice(0, 2)).toEqual(['blue', 'blueviolet']);
    });

    it('groups all prefix matches for "gr" ahead of substring-only matches', () => {
        const result = filterColors('gr');
        // CSS_COLORS' own order for the "gr..." names is gray, green,
        // greenyellow, grey — all prefix matches, so that order survives.
        expect(result.slice(0, 4)).toEqual(['gray', 'green', 'greenyellow', 'grey']);
        // A substring-only match (the query is in the middle, not the
        // start) comes after every prefix match.
        expect(result.indexOf('darkgray')).toBeGreaterThan(result.indexOf('grey'));
    });

    it('puts an exact match first', () => {
        expect(filterColors('red')[0]).toBe('red');
    });

    it('is case-insensitive', () => {
        expect(filterColors('BLU')).toEqual(filterColors('blu'));
    });

    it('returns no candidates for a hex-shaped query', () => {
        expect(filterColors('#fff')).toEqual([]);
        expect(filterColors('fff000')).toEqual([]);
    });

    it('applies limit after ranking, not before', () => {
        // Unranked (source-order) truncation would cut off before reaching
        // "blue" at all, since it's far from the front of CSS_COLORS.
        expect(filterColors('blu', 3)).toEqual(['blue', 'blueviolet', 'aliceblue']);
    });

    it('returns the full list in declared order for an empty query', () => {
        const all = filterColors('');
        expect(all[0]).toBe('aliceblue');
        expect(all.length).toBeGreaterThan(100);
    });
});
