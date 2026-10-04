import { describe, it, expect } from 'vitest';
import { DATE_PRESET_SYNTAX, NAMED_DATE_PRESETS, parseDatePreset } from '../../../src/services/filter/DatePreset';
import { RELATIVE_DATE_PRESETS } from '../../../src/services/filter/FilterTypes';

describe('parseDatePreset', () => {
    const ok = (value: unknown) => ({ ok: true, value });

    it('reads an absolute date', () => {
        expect(parseDatePreset(' 2026-03-14 ')).toEqual(ok('2026-03-14'));
    });

    it('reads an absolute date as typed text: full-width and hyphen-like characters', () => {
        expect(parseDatePreset('２０２６－０３－１４')).toEqual(ok('2026-03-14'));
        expect(parseDatePreset('2026ー03ー14')).toEqual(ok('2026-03-14'));
    });

    it('refuses a date-shaped value that names no day', () => {
        expect(parseDatePreset('2026-02-30')).toEqual({ ok: false, issue: { code: 'noSuchDay' } });
        expect(parseDatePreset('2026-13-45')).toEqual({ ok: false, issue: { code: 'noSuchDay' } });
    });

    it('reads every named preset in any case', () => {
        for (const p of NAMED_DATE_PRESETS) {
            expect(parseDatePreset(p.toUpperCase())).toEqual(ok({ preset: p }));
        }
        expect(parseDatePreset(' ｔｏｄａｙ ')).toEqual(ok({ preset: 'today' }));
    });

    it('reads next<N>days', () => {
        expect(parseDatePreset('next30days')).toEqual(ok({ preset: 'nextNDays', n: 30 }));
    });

    it('refuses next0days: N is one or more, as the menu\'s field takes it', () => {
        expect(parseDatePreset('next0days')).toEqual({ ok: false, issue: { code: 'range', min: 1 } });
    });

    it('rejects anything else as not a date', () => {
        const notADate = { ok: false, issue: { code: 'shape', kind: 'date' } };
        expect(parseDatePreset('nextndays')).toEqual(notADate);
        expect(parseDatePreset('2026/03/14')).toEqual(notADate);
        expect(parseDatePreset('yesterday')).toEqual(notADate);
    });

    it('names every preset in the syntax the errors show', () => {
        expect(NAMED_DATE_PRESETS).toHaveLength(RELATIVE_DATE_PRESETS.length - 1);
        expect(DATE_PRESET_SYNTAX).toBe('today, thisWeek, nextWeek, pastWeek, nextNdays, thisMonth, thisYear');
    });
});
