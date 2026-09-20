import { describe, it, expect } from 'vitest';
import { filterLineStyles } from '../../../../src/suggest/line/lineStyleUtils';

describe('filterLineStyles', () => {
    it('groups the prefix matches for "da" ahead of nothing else, in LINE_STYLES order', () => {
        // "dashed" and "dashdotted" both prefix-match "da"; LINE_STYLES
        // declares dashed before dashdotted, and that must survive.
        expect(filterLineStyles('da')).toEqual(['dashed', 'dashdotted']);
    });

    it('keeps LINE_STYLES declared order among tied prefix matches, not alphabetical', () => {
        // Alphabetically "dashdotted" sorts before "dashed" — LINE_STYLES'
        // own (meaningful) order is the reverse, and a rank-only stable
        // sort must not undo that. "solid" only contains "d" (substring,
        // not prefix), so it ranks after every "d...*" prefix match despite
        // being LINE_STYLES' first entry.
        expect(filterLineStyles('d')).toEqual(['dashed', 'dotted', 'double', 'dashdotted', 'solid']);
    });

    it('puts an exact match first', () => {
        expect(filterLineStyles('dotted')).toEqual(['dotted', 'dashdotted']);
    });

    it('is case-insensitive', () => {
        expect(filterLineStyles('DA')).toEqual(filterLineStyles('da'));
    });

    it('returns the full list in declared (non-alphabetical) order for an empty query', () => {
        expect(filterLineStyles('')).toEqual(['solid', 'dashed', 'dotted', 'double', 'dashdotted']);
    });
});
