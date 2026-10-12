import { describe, it, expect } from 'vitest';
import { setMockLocale } from '../../mocks/obsidian';
import { initI18n } from '../../../../src/i18n';
import ja from '../../../../src/i18n/locales/ja.json';
import { diagnosticText } from '../../../../src/services/lang/flow/diagnosticText';
import { Outline } from '../../../../src/services/parsing/utils/Outline';
import { propertyDiagnostics } from '../../../../src/services/parsing/tree/PropertyDiagnostics';
import { FileParsePipeline } from '../../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../../src/services/core/RowNames';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS, type ScopeKeys } from '../../../../src/types';

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
    'unreadable-value': {
        lines: ['## S', '- tv-linestyle:: wavy', '- tv-color::', '    - red', '- [ ] t', '    - tv-mask::'],
        expected: [['property.unreadable-value', 'warning', 1], ['property.unreadable-value', 'warning', 2]],
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

        it('says of a built-in\'s value it cannot read that the line is read as not written', () => {
            const [d] = diagnose(KINDS['unreadable-value'].lines);
            expect(d.params).toEqual({ key: 'tv-linestyle', text: 'tv-linestyle:: wavy' });
            expect(d.message).toContain('`tv-linestyle::`');
            expect(d.message).toContain('read as if it were not written');
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

describe('Task.propertyFindings', () => {
    const tasksOf = (lines: string[]) => FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks;

    it('holds the findings of the task\'s own lines, with the key and the property line each is about', () => {
        const [t, u] = tasksOf(['- area:: x', '  - note', '- [ ] t', '    - author::', '        - name:: Kawa', '    - [ ] u', '        - a:: 1', '        - A:: 2']);
        expect(t.propertyFindings?.map(f => [f.kind, f.line, f.key, f.propertyLine])).toEqual([['property-shaped-item', 4, 'author', 3]]);
        expect(u.propertyFindings?.map(f => [f.kind, f.line, f.key, f.propertyLine])).toEqual([
            ['duplicate-key', 6, 'a', 6],
            ['duplicate-key', 7, 'A', 7],
        ]);
    });

    it('is absent on a task whose lines have none', () => {
        const [t] = tasksOf(['- [ ] t', '    - area:: lab']);
        expect(t.propertyFindings).toBeUndefined();
    });
});
