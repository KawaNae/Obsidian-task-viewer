import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../../../src/i18n/locales/en.json';

const SOURCE = resolve(__dirname, '../../../src/views/customMenus/IntervalTemplateCreator.ts');
const source = readFileSync(SOURCE, 'utf-8');
const table = (en as { timer: { template: Record<string, string> } }).timer.template;

describe('timer.template', () => {
    it('every key is used by the creator', () => {
        const unused = Object.keys(table).filter(k => !source.includes(`timer.template.${k}`));
        expect(unused).toEqual([]);
    });

    it('every key the creator asks for exists', () => {
        const asked = [...source.matchAll(/timer\.template\.(\w+)/g)].map(m => m[1]);
        expect(asked.length).toBeGreaterThan(0);
        expect([...new Set(asked)].filter(k => !(k in table))).toEqual([]);
    });

    /**
     * The segment labels the form seeds and falls back to are written into the
     * template FILE, not just shown. Translating them would make a saved
     * template's contents depend on the locale it was created in, so a vault
     * synced between an English and a Japanese install would hold two
     * different label vocabularies for the same concept. The button that
     * *displays* the segment type (timer.template.typeWork / typeBreak /
     * typePrepare) is the translated one; these are not.
     */
    it('keeps the persisted segment labels in English', () => {
        // Counted, not just inspected: translating SOME of the four seeds
        // would leave the set looking right while the file gained a
        // locale-dependent label.
        const seeds = [...source.matchAll(/label: (.+?), hours:/g)].map(m => m[1]);
        expect(seeds).toEqual(["'Work'", "'Work'", "'Work'", "'Break'"]);

        const fallback = [...source.matchAll(/s\.label\.trim\(\) \|\| \(s\.type === 'work' \? (.+?) : (.+?)\)/g)];
        expect(fallback).toHaveLength(1);
        expect([fallback[0][1], fallback[0][2]]).toEqual(["'Work'", "'Break'"]);
    });
});
