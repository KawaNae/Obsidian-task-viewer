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
