import { describe, it, expect } from 'vitest';
import { DATE_PRESET_SYNTAX, NAMED_DATE_PRESETS, parseDatePreset } from '../../../src/services/filter/DatePreset';
import { RELATIVE_DATE_PRESETS } from '../../../src/services/filter/FilterTypes';

describe('parseDatePreset', () => {
    it('reads an absolute date by shape', () => {
        expect(parseDatePreset(' 2026-03-14 ')).toBe('2026-03-14');
    });

    it('reads every named preset in any case', () => {
        for (const p of NAMED_DATE_PRESETS) {
            expect(parseDatePreset(p.toUpperCase())).toEqual({ preset: p });
        }
    });

    it('reads next<N>days', () => {
        expect(parseDatePreset('next30days')).toEqual({ preset: 'nextNDays', n: 30 });
    });

    it('rejects anything else', () => {
        expect(parseDatePreset('nextndays')).toBeNull();
        expect(parseDatePreset('2026/03/14')).toBeNull();
        expect(parseDatePreset('yesterday')).toBeNull();
    });

    it('names every preset in the syntax the errors show', () => {
        expect(NAMED_DATE_PRESETS).toHaveLength(RELATIVE_DATE_PRESETS.length - 1);
        expect(DATE_PRESET_SYNTAX).toBe('today, thisWeek, nextWeek, pastWeek, nextNdays, thisMonth, thisYear');
    });
});
