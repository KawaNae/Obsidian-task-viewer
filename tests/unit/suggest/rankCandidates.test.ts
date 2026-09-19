import { describe, it, expect } from 'vitest';
import { rankCandidates } from '../../../src/suggest/rankCandidates';
import { filterColors } from '../../../src/suggest/color/colorUtils';
import { filterLineStyles } from '../../../src/suggest/line/lineStyleUtils';

describe('rankCandidates', () => {
    it('puts a prefix match ahead of a substring match, whatever the list order', () => {
        // `aliceblue` sorts first alphabetically but only contains the query.
        expect(rankCandidates(['aliceblue', 'blue', 'cadetblue'], 'blu')[0]).toBe('blue');
    });

    it('puts an exact match ahead of a longer prefix match', () => {
        expect(rankCandidates(['blueviolet', 'blue'], 'blue')[0]).toBe('blue');
    });

    it('keeps the list order inside one rank', () => {
        expect(rankCandidates(['dashed', 'dotted', 'double', 'dashdotted'], 'd'))
            .toEqual(['dashed', 'dotted', 'double', 'dashdotted']);
    });

    it('returns the whole list in its own order for an empty query', () => {
        expect(rankCandidates(['solid', 'dashed', 'dotted'], '')).toEqual(['solid', 'dashed', 'dotted']);
    });

    it('drops candidates the query does not appear in', () => {
        expect(rankCandidates(['red', 'green', 'blue'], 'ee')).toEqual(['green']);
    });

    it('ignores case and surrounding spaces in the query', () => {
        expect(rankCandidates(['blue', 'aliceblue'], '  BLU  ')[0]).toBe('blue');
    });

    it('applies the limit after ranking, not before', () => {
        expect(rankCandidates(['aliceblue', 'blue'], 'blu', 1)).toEqual(['blue']);
    });
});

describe('filterColors', () => {
    // #171: `blu` + Enter used to commit aliceblue, because the candidates came
    // back in alphabetical order and Enter takes the first one.
    it('offers blue first for `blu`', () => {
        expect(filterColors('blu')[0]).toBe('blue');
    });

    it('offers the exact name first when the query is a whole colour', () => {
        expect(filterColors('red')[0]).toBe('red');
        expect(filterColors('green')[0]).toBe('green');
    });

    it('still lists the substring matches after the prefix ones', () => {
        const hits = filterColors('blu');
        expect(hits).toContain('aliceblue');
        expect(hits.indexOf('blue')).toBeLessThan(hits.indexOf('aliceblue'));
    });

    it('keeps alphabetical order among the prefix matches', () => {
        expect(filterColors('blu').slice(0, 3)).toEqual(['blue', 'blueviolet', 'aliceblue']);
    });
});

describe('filterLineStyles', () => {
    it('offers the exact style first', () => {
        expect(filterLineStyles('dotted')[0]).toBe('dotted');
    });

    it('keeps the authored order, which is not alphabetical', () => {
        expect(filterLineStyles('')).toEqual(['solid', 'dashed', 'dotted', 'double', 'dashdotted']);
    });

    it('offers dashed before dashdotted for `dash`', () => {
        expect(filterLineStyles('dash')).toEqual(['dashed', 'dashdotted']);
    });
});
