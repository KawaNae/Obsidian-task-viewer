import { describe, it, expect } from 'vitest';
import { ChildLineClassifier } from '../../src/utils/ChildLineClassifier';

describe('ChildLineClassifier', () => {
    describe('classify', () => {
        it('parses checkbox child line', () => {
            const result = ChildLineClassifier.classify('  - [x] sub task');
            expect(result.indent).toBe('  ');
            expect(result.checkboxChar).toBe('x');
            expect(result.wikilinkTarget).toBeNull();
            expect(result.text).toBe('  - [x] sub task');
        });

        it('parses unchecked checkbox', () => {
            const result = ChildLineClassifier.classify('  - [ ] todo');
            expect(result.checkboxChar).toBe(' ');
        });

        it('parses wikilink child line', () => {
            const result = ChildLineClassifier.classify('  - [[My Task]]');
            expect(result.wikilinkTarget).toBe('My Task');
            expect(result.checkboxChar).toBeNull();
        });

        it('parses wikilink with alias', () => {
            const result = ChildLineClassifier.classify('  - [[path/to/note|Display Name]]');
            expect(result.wikilinkTarget).toBe('path/to/note');
        });

        it('parses plain text line', () => {
            const result = ChildLineClassifier.classify('  just text');
            expect(result.checkboxChar).toBeNull();
            expect(result.wikilinkTarget).toBeNull();
            expect(result.indent).toBe('  ');
        });

        it('parses empty line', () => {
            const result = ChildLineClassifier.classify('');
            expect(result.indent).toBe('');
            expect(result.checkboxChar).toBeNull();
            expect(result.wikilinkTarget).toBeNull();
        });

        it('handles tab indent', () => {
            const result = ChildLineClassifier.classify('\t- [x] tab');
            expect(result.indent).toBe('\t');
            expect(result.checkboxChar).toBe('x');
        });

        it('handles asterisk marker checkbox', () => {
            const result = ChildLineClassifier.classify('  * [x] star');
            expect(result.checkboxChar).toBe('x');
        });

        it('handles plus marker checkbox', () => {
            const result = ChildLineClassifier.classify('  + [ ] plus');
            expect(result.checkboxChar).toBe(' ');
        });

        it('handles numbered marker checkbox', () => {
            const result = ChildLineClassifier.classify('  1. [x] numbered');
            expect(result.checkboxChar).toBe('x');
        });
    });

    describe('property lines (:: notation)', () => {
        it('parses double-colon property line', () => {
            const result = ChildLineClassifier.classify('\t- 金額:: 2000');
            expect(result.propertyKey).toBe('金額');
            expect(result.propertyValue).toBe('2000');
            expect(result.checkboxChar).toBeNull();
        });

        it('parses property with no space after ::', () => {
            const result = ChildLineClassifier.classify('\t- key::value');
            expect(result.propertyKey).toBe('key');
            expect(result.propertyValue).toBe('value');
        });

        it('does NOT parse single-colon as property', () => {
            const result = ChildLineClassifier.classify('\t- 金額: 2000');
            expect(result.propertyKey).toBeNull();
            expect(result.propertyValue).toBeNull();
        });

        it('does not extract property from checkbox lines', () => {
            const result = ChildLineClassifier.classify('\t- [x] key:: value');
            expect(result.checkboxChar).toBe('x');
            expect(result.propertyKey).toBeNull();
        });

        it('does not extract property from wikilink lines', () => {
            const result = ChildLineClassifier.classify('\t- [[key:: value]]');
            expect(result.propertyKey).toBeNull();
        });
    });

    describe('collectProperties', () => {
        it('collects properties from classified lines', () => {
            const lines = ChildLineClassifier.classifyLines([
                '\t- 金額:: 2000',
                '\t- 優先度:: 高',
                '\t- [x] checkbox',
            ]);
            const props = ChildLineClassifier.collectProperties(lines);
            expect(props).toEqual({ '金額': '2000', '優先度': '高' });
        });

        it('returns empty object when no properties', () => {
            const lines = ChildLineClassifier.classifyLines([
                '\t- [x] checkbox',
                '\t- [[Link]]',
            ]);
            expect(ChildLineClassifier.collectProperties(lines)).toEqual({});
        });
    });

    describe('classifyLines', () => {
        it('classifies multiple lines', () => {
            const results = ChildLineClassifier.classifyLines([
                '  - [x] done',
                '  - [[Link]]',
                '  plain text',
            ]);
            expect(results).toHaveLength(3);
            expect(results[0].checkboxChar).toBe('x');
            expect(results[1].wikilinkTarget).toBe('Link');
            expect(results[2].checkboxChar).toBeNull();
        });

        it('handles empty array', () => {
            expect(ChildLineClassifier.classifyLines([])).toHaveLength(0);
        });
    });
});
