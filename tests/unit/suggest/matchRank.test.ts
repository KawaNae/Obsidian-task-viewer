import { describe, it, expect } from 'vitest';
import { rankMatch, sortByMatchRank } from '../../../src/suggest/matchRank';

describe('rankMatch', () => {
    it('ranks an exact match above a prefix match', () => {
        expect(rankMatch('red', 'red')).toBeLessThan(rankMatch('reddish', 'red'));
    });

    it('ranks a prefix match above a plain substring match', () => {
        expect(rankMatch('blue', 'blu')).toBeLessThan(rankMatch('aliceblue', 'blu'));
    });

    it('ranks a non-match below every match', () => {
        const none = rankMatch('green', 'blu');
        expect(none).toBeGreaterThan(rankMatch('blue', 'blu'));
        expect(none).toBeGreaterThan(rankMatch('aliceblue', 'blu'));
    });
});

describe('sortByMatchRank', () => {
    it('keeps the input order for candidates tied on rank (stable, not alphabetical)', () => {
        // 'zulu' and 'zeta' both start with "z" (tied at prefix rank);
        // 'xyz' only contains it (substring rank). A rank-only stable sort
        // must keep zulu ahead of zeta — their input order — even though
        // 'zeta' sorts first alphabetically.
        const items = ['xyz', 'zulu', 'zeta'];
        expect(sortByMatchRank(items, 'z')).toEqual(['zulu', 'zeta', 'xyz']);
    });
});
