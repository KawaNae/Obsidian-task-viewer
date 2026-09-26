import { describe, it, expect } from 'vitest';
import { ChildLineClassifier } from '../../../src/services/parsing/utils/ChildLineClassifier';
import { Outline } from '../../../src/services/parsing/utils/Outline';

const NBSP = String.fromCharCode(0x00a0);
const IDEOGRAPHIC = String.fromCharCode(0x3000);

describe('ChildLineClassifier', () => {
    describe('classify', () => {
        // A checkbox is a task of its own and never lands in childLines outside a
        // code fence; there it is an example, so it carries no property or link.
        it('keeps a checkbox line as plain text with no property or link', () => {
            const result = ChildLineClassifier.classify('  - [x] key:: sub task', 0);
            expect(result.indent).toBe('  ');
            expect(result.wikilinkTarget).toBeNull();
            expect(result.propertyKey).toBeNull();
            expect(result.text).toBe('  - [x] key:: sub task');
        });

        it('parses wikilink child line', () => {
            const result = ChildLineClassifier.classify('  - [[My Task]]', 0);
            expect(result.wikilinkTarget).toBe('My Task');
        });

        it('parses wikilink with alias', () => {
            const result = ChildLineClassifier.classify('  - [[path/to/note|Display Name]]', 0);
            expect(result.wikilinkTarget).toBe('path/to/note');
        });

        it('parses wikilink child with any list bullet', () => {
            expect(ChildLineClassifier.classify('  * [[Note A]]', 0).wikilinkTarget).toBe('Note A');
            expect(ChildLineClassifier.classify('  + [[Note B]]', 0).wikilinkTarget).toBe('Note B');
            expect(ChildLineClassifier.classify('  1. [[Note C]]', 0).wikilinkTarget).toBe('Note C');
            expect(ChildLineClassifier.classify('  2) [[Note D]]', 0).wikilinkTarget).toBe('Note D');
        });

        it('parses plain text line', () => {
            const result = ChildLineClassifier.classify('  just text', 0);
            expect(result.wikilinkTarget).toBeNull();
            expect(result.propertyKey).toBeNull();
            expect(result.indent).toBe('  ');
        });

        it('parses empty line', () => {
            const result = ChildLineClassifier.classify('', 0);
            expect(result.indent).toBe('');
            expect(result.wikilinkTarget).toBeNull();
        });

        it('handles tab indent', () => {
            const result = ChildLineClassifier.classify('\t- tab', 0);
            expect(result.indent).toBe('\t');
        });
    });

    describe('property lines (:: notation)', () => {
        it('parses double-colon property line', () => {
            const result = ChildLineClassifier.classify('\t- 金額:: 2000', 0);
            expect(result.propertyKey).toBe('金額');
            expect(result.propertyValue).toBe('2000');
        });

        it('parses property with no space after ::', () => {
            const result = ChildLineClassifier.classify('\t- key::value', 0);
            expect(result.propertyKey).toBe('key');
            expect(result.propertyValue).toBe('value');
        });

        it('parses empty-value property (`- key ::`)', () => {
            const result = ChildLineClassifier.classify('    - key ::', 0);
            expect(result.propertyKey).toBe('key');
            expect(result.propertyValue).toBe('');
        });

        it('empty-value recognition does not depend on trailing whitespace', () => {
            const noTrail = ChildLineClassifier.classify('    - key ::', 0);
            const trail = ChildLineClassifier.classify('    - key :: ', 0);
            expect(noTrail.propertyKey).toBe('key');
            expect(trail.propertyKey).toBe('key');
            expect(noTrail.propertyValue).toBe('');
            expect(trail.propertyValue).toBe('');
        });

        it('does not treat bare `- ::` as property (empty key)', () => {
            const result = ChildLineClassifier.classify('- ::', 0);
            expect(result.propertyKey).toBeNull();
        });

        it('does NOT parse single-colon as property', () => {
            const result = ChildLineClassifier.classify('\t- 金額: 2000', 0);
            expect(result.propertyKey).toBeNull();
            expect(result.propertyValue).toBeNull();
        });

        it('does not extract property from checkbox lines', () => {
            const result = ChildLineClassifier.classify('\t- [x] key:: value', 0);
            expect(result.propertyKey).toBeNull();
        });

        it('does not extract property from wikilink lines', () => {
            const result = ChildLineClassifier.classify('\t- [[key:: value]]', 0);
            expect(result.propertyKey).toBeNull();
        });

        it('reads no property or link on a line whose bullet opens no list item (Obsidian, measurement.md q9)', () => {
            // After the bullet, a list item has spaces or tabs and nothing else.
            for (const gap of ['', ' ', '　']) {
                const outline = Outline.read(['- [ ] task', `\t-${gap}key:: value`]);
                expect(ChildLineClassifier.ownPropertyLines(outline, 0), JSON.stringify(gap)).toEqual([]);
                expect(ChildLineClassifier.classify(`\t-${gap}[[note]]`, 0).wikilinkTarget).toBeNull();
            }
            const outline = Outline.read(['- [ ] task', '\t-\tkey:: value']);
            expect(ChildLineClassifier.ownPropertyLines(outline, 0)).toEqual([1]);
        });
    });

    describe('collectProperties', () => {
        it('collects properties from classified lines', () => {
            const lines = ChildLineClassifier.classifyLines([
                '\t- 金額:: 2000',
                '\t- 優先度:: 高',
                '\t- [x] checkbox',
            ], [1, 2, 3]);
            const props = ChildLineClassifier.collectProperties(lines);
            expect(props).toEqual({
                '金額': { value: '2000', type: 'number' },
                '優先度': { value: '高', type: 'string' },
            });
        });

        it('returns empty object when no properties', () => {
            const lines = ChildLineClassifier.classifyLines([
                '\t- [x] checkbox',
                '\t- [[Link]]',
            ], [1, 2]);
            expect(ChildLineClassifier.collectProperties(lines)).toEqual({});
        });
    });

    describe('inferType', () => {
        it('number: integer', () => {
            expect(ChildLineClassifier.inferType('2000')).toBe('number');
        });
        it('number: decimal', () => {
            expect(ChildLineClassifier.inferType('3.14')).toBe('number');
        });
        it('boolean: True', () => {
            expect(ChildLineClassifier.inferType('True')).toBe('boolean');
        });
        it('boolean: False', () => {
            expect(ChildLineClassifier.inferType('False')).toBe('boolean');
        });
        it('lowercase true is string', () => {
            expect(ChildLineClassifier.inferType('true')).toBe('string');
        });
        it('lowercase false is string', () => {
            expect(ChildLineClassifier.inferType('false')).toBe('string');
        });
        it('array: [a, b]', () => {
            expect(ChildLineClassifier.inferType('[a, b]')).toBe('array');
        });
        it('array: [single]', () => {
            expect(ChildLineClassifier.inferType('[single]')).toBe('array');
        });
        it('array: comma without brackets', () => {
            expect(ChildLineClassifier.inferType('apple, banana')).toBe('array');
        });
        it('string: plain text', () => {
            expect(ChildLineClassifier.inferType('高')).toBe('string');
        });
    });

    describe('classifyLines', () => {
        it('classifies multiple lines and carries bodyLines', () => {
            const results = ChildLineClassifier.classifyLines([
                '  - [x] done',
                '  - [[Link]]',
                '  plain text',
            ], [5, 6, 7]);
            expect(results).toHaveLength(3);
            expect(results[0].wikilinkTarget).toBeNull();
            expect(results[1].wikilinkTarget).toBe('Link');
            expect(results[2].wikilinkTarget).toBeNull();
            expect(results.map(r => r.bodyLine)).toEqual([5, 6, 7]);
        });

        it('handles empty array', () => {
            expect(ChildLineClassifier.classifyLines([], [])).toHaveLength(0);
        });

        it('throws on parallel-input length mismatch', () => {
            expect(() => ChildLineClassifier.classifyLines(['- a'], [])).toThrow();
        });

        it('ownPropertyLines keeps only the task\'s own `- key:: value` children', () => {
            const outline = Outline.read([
                '- [ ] task',
                '\t- key:: value',
                '\t- [x] key:: value',
                '\t- [[key:: value]]',
                '\t- plain note',
            ]);
            expect(ChildLineClassifier.ownPropertyLines(outline, 0)).toEqual([1]);
        });

        it('tells a task\'s own property line from a deeper one by depth, not by indent length', () => {
            // A tab reaches the next multiple of four columns, so two indents
            // of the same length in characters can stand at very different
            // depths. Line 2 is a grandchild (nested under key1's own item);
            // line 3 is the task's own property. Both have a 2-character
            // indent, but only line 3 belongs in the result.
            const outline = Outline.read([
                '- [ ] task',
                '\t- key1:: v1',
                '\t\t- key2:: v2',
                '  - key3:: v3',
            ]);
            expect(Outline.indentOf(outline.lines[2]).length).toBe(Outline.indentOf(outline.lines[3]).length);
            expect(outline.item(2)!.parent).toBe(1);
            expect(outline.item(3)!.parent).toBe(0);
            expect(ChildLineClassifier.ownPropertyLines(outline, 0)).toEqual([1, 3]);
        });
    });
});
