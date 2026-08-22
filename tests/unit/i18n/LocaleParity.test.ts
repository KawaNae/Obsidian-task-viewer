import { describe, expect, it } from 'vitest';
import en from '../../../src/i18n/locales/en.json';
import ja from '../../../src/i18n/locales/ja.json';
import { t } from '../../../src/i18n';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') out[path] = v;
        else Object.assign(out, flatten(v, path));
    }
    return out;
}

/**
 * `flowDiag` / `flowEval` are ja-only by design: English for those two lives
 * as the `message` field in the diagnostic's TS source, not in en.json
 * (services/flow/diagnosticText.ts, and reference_diagnostic_i18n.md).
 * Everything else must exist in both.
 */
const JA_ONLY_NAMESPACES = ['flowDiag', 'flowEval'];

const EN = flatten(en as Tree);
const JA = flatten(ja as Tree);
const shared = (keys: string[]) => keys.filter(k => !JA_ONLY_NAMESPACES.includes(k.split('.')[0]));

describe('locale parity', () => {
    it('every en key has a ja translation', () => {
        expect(Object.keys(EN).filter(k => !(k in JA))).toEqual([]);
    });

    it('every ja key outside the ja-only namespaces has an en source', () => {
        expect(shared(Object.keys(JA)).filter(k => !(k in EN))).toEqual([]);
    });

    it('the ja-only namespaces are the documented two, and are really ja-only', () => {
        const jaOnly = Object.keys(JA).filter(k => !(k in EN));
        expect(jaOnly.length).toBeGreaterThan(0);
        expect([...new Set(jaOnly.map(k => k.split('.')[0]))].sort()).toEqual(JA_ONLY_NAMESPACES);
    });

    // A key whose en text interpolates a param but whose ja text does not
    // renders as a sentence with the value silently missing.
    it('both locales interpolate the same params for a shared key', () => {
        const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort();
        const mismatched = shared(Object.keys(EN))
            .filter(k => JSON.stringify(params(EN[k])) !== JSON.stringify(params(JA[k])));
        expect(mismatched).toEqual([]);
    });

    /**
     * `filter.glue.*` is the one namespace where empty is the value: it holds
     * Japanese particles that glue a filter sentence together, and English
     * needs none of them (FilterValueHelpers renders nothing for an empty
     * glue). Anywhere else an empty string is a translation someone forgot,
     * which ships as a blank label.
     */
    const GLUE = 'filter.glue.';
    const blanks = (table: Record<string, string>) =>
        Object.entries(table).filter(([k, v]) => v.trim() === '' && !k.startsWith(GLUE)).map(([k]) => k);

    it('no key outside filter.glue is left empty in either locale', () => {
        expect(blanks(EN)).toEqual([]);
        expect(blanks(JA)).toEqual([]);
    });

    it('filter.glue really is the only place empty values live', () => {
        const empties = [...Object.entries(EN), ...Object.entries(JA)].filter(([, v]) => v.trim() === '');
        expect(empties.length).toBeGreaterThan(0);
        expect(empties.every(([k]) => k.startsWith(GLUE))).toBe(true);
    });
});

describe('t()', () => {
    it('substitutes a param into the text', () => {
        expect(t('timer.minutesRange', { min: 1, max: 120 })).toBe('Minutes (1-120)');
    });

    it('falls back to the key itself when nothing resolves', () => {
        expect(t('no.such.key')).toBe('no.such.key');
    });
});
