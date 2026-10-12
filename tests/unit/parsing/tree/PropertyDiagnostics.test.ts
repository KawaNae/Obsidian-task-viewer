import { describe, it, expect } from 'vitest';
import { setMockLocale } from '../../mocks/obsidian';
import { initI18n } from '../../../../src/i18n';
import ja from '../../../../src/i18n/locales/ja.json';
import { diagnosticText } from '../../../../src/services/lang/flow/diagnosticText';
import { Outline } from '../../../../src/services/parsing/utils/Outline';
import { propertyDiagnostics } from '../../../../src/services/parsing/tree/PropertyDiagnostics';
import { DEFAULT_SCOPE_KEYS, type ScopeKeys } from '../../../../src/types';

/**
 * The editor's diagnostics on property lines: each finding of the reading
 * (`PropertyLines.read`), of every task and every section, on the line it is
 * about, with a sentence that says what the plugin did and how to write it.
 */

const diagnose = (lines: string[], keys: ScopeKeys = DEFAULT_SCOPE_KEYS) => propertyDiagnostics(Outline.read(lines), keys);

/** Diagnostics as `[code, severity, line]`. */
const brief = (lines: string[], keys?: ScopeKeys) => diagnose(lines, keys).map(d => [d.code, d.severity, d.line]);

/** A note for each kind of finding, under a task. */
const KINDS: Record<string, { lines: string[]; expected: (string | number)[][] }> = {
    'duplicate-key': {
        lines: ['- [ ] t', '    - a:: 1', '    - A:: 2'],
        expected: [['property.duplicate-key', 'error', 1], ['property.duplicate-key', 'error', 2]],
    },
    'date-key-under-task': {
        lines: ['- [ ] t', '    - tv-start:: 2026-01-01'],
        expected: [['property.date-key-under-task', 'warning', 1]],
    },
    'lines-under-value': {
        lines: ['- [ ] t', '    - area:: lab', '      text', '        - note'],
        expected: [['property.lines-under-value', 'warning', 2], ['property.lines-under-value', 'warning', 3]],
    },
    'property-shaped-item': {
        lines: ['- [ ] t', '    - author::', '        - name:: Kawa'],
        expected: [['property.property-shaped-item', 'warning', 2]],
    },
    'not-a-list-item': {
        lines: ['- [ ] t', '    - list::', '        - a', '        - [ ] sub', '        -'],
        expected: [['property.not-a-list-item', 'warning', 3], ['property.not-a-list-item', 'warning', 4]],
    },
};

describe('propertyDiagnostics', () => {
    describe('each kind of finding, on the line it is about', () => {
        for (const [kind, { lines, expected }] of Object.entries(KINDS)) {
            it(kind, () => {
                expect(brief(lines)).toEqual(expected);
            });
        }

        it('an item under a line with a value is marked on the item, not on the property line', () => {
            expect(diagnose(['- [ ] t', '    - area:: lab', '        - note']).map(d => d.line)).toEqual([2]);
        });

        it('a run of lines a finding covers is marked on its first line', () => {
            expect(brief(['- [ ] t', '    - list::', '        - a', '            - nested', '            - more']))
                .toEqual([['property.not-a-list-item', 'warning', 3]]);
        });
    });

    describe('the owners', () => {
        it('a section opened by a heading', () => {
            expect(brief(['# H', '- a:: 1', '- [ ] t', '- a:: 2'])).toEqual([
                ['property.duplicate-key', 'error', 1],
                ['property.duplicate-key', 'error', 3],
            ]);
        });

        it('the lines above the first heading, past the frontmatter', () => {
            expect(brief(['---', 'a: 1', 'a: 2', '---', '- area:: x', '  - note', '# H', '- author::', '  - name:: Kawa'])).toEqual([
                ['property.lines-under-value', 'warning', 5],
                ['property.property-shaped-item', 'warning', 8],
            ]);
        });

        it('a task under a task, and a section and a task in one note, each its own', () => {
            expect(brief(['## S', '- a:: 1', '- [ ] t', '    - a:: 1', '    - [ ] u', '        - a:: 2', '        - a:: 3'])).toEqual([
                ['property.duplicate-key', 'error', 5],
                ['property.duplicate-key', 'error', 6],
            ]);
        });

        it('a section may write a date key; a line deeper than an owner\'s is no one\'s', () => {
            expect(brief(['# H', '- tv-start:: 2026-01-01', '- note', '    - a:: 1', '    - a:: 2'])).toEqual([]);
        });

        it('a task\'s date keys are the settings\'', () => {
            const keys = { ...DEFAULT_SCOPE_KEYS, start: 'begin' };
            expect(brief(['- [ ] t', '    - begin:: 2026-01-01', '    - tv-start:: 2026-01-01'], keys))
                .toEqual([['property.date-key-under-task', 'warning', 1]]);
        });

        it('no finding, no diagnostic', () => {
            expect(diagnose(['# H', '- area:: lab', '- [ ] t', '    - tags::', '        - #a', '    - list::', '        - x'])).toEqual([]);
        });
    });

    describe('the mark and the sentence', () => {
        it('marks the line from past its indentation to its end', () => {
            const [d] = diagnose(['- [ ] t', '    - author::', '        - name:: Kawa']);
            expect(d.span).toEqual({ start: 8, end: 21 });
        });

        it('gives the key and the line\'s text, its marker left off', () => {
            const [d] = diagnose(['- [ ] t', '    - author::', '        - name:: Kawa']);
            expect(d.params).toEqual({ key: 'author', text: 'name:: Kawa' });
            expect(d.message).toBe('`name:: Kawa` is read as an item of the list `author`. To make it a property, write it at the depth of `author::`. Properties do not nest');
        });

        it('names the key as the line writes it', () => {
            expect(diagnose(['- [ ] t', '    - Area:: 1', '    - area:: 2']).map(d => d.params?.key)).toEqual(['Area', 'area']);
        });

        it('says it in Japanese, every kind, with nothing left to fill', () => {
            const kinds = Object.keys(KINDS);
            const property = (ja as { flowDiag: { property: Record<string, string> } }).flowDiag.property;
            expect(Object.keys(property).sort()).toEqual([...kinds].sort());
            setMockLocale('ja');
            initI18n();
            try {
                for (const kind of kinds) {
                    for (const d of diagnose(KINDS[kind].lines)) {
                        const text = diagnosticText(d);
                        expect(text).not.toBe(d.message);
                        expect(text).not.toContain('{{');
                    }
                }
                const [d] = diagnose(KINDS['property-shaped-item'].lines);
                expect(diagnosticText(d)).toBe('`name:: Kawa` は `author` のリストの項目として読みました。プロパティにするなら、`author::` と同じ深さに書いてください。入れ子のプロパティは使えません');
            } finally {
                setMockLocale('en');
                initI18n();
            }
        });
    });
});

