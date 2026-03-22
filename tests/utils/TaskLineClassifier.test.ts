import { describe, it, expect } from 'vitest';
import { TaskLineClassifier } from '../../src/services/parsing/utils/TaskLineClassifier';

describe('TaskLineClassifier', () => {
    describe('classify', () => {
        it('parses basic dash task', () => {
            const result = TaskLineClassifier.classify('- [ ] hello world');
            expect(result).not.toBeNull();
            expect(result!.indent).toBe('');
            expect(result!.statusChar).toBe(' ');
            expect(result!.rawContent).toBe('hello world');
        });

        it('parses completed task', () => {
            const result = TaskLineClassifier.classify('- [x] done task');
            expect(result).not.toBeNull();
            expect(result!.statusChar).toBe('x');
            expect(result!.rawContent).toBe('done task');
        });

        it('parses indented task', () => {
            const result = TaskLineClassifier.classify('    - [ ] indented');
            expect(result).not.toBeNull();
            expect(result!.indent).toBe('    ');
            expect(result!.rawContent).toBe('indented');
        });

        it('parses tab-indented task', () => {
            const result = TaskLineClassifier.classify('\t- [ ] tab indented');
            expect(result).not.toBeNull();
            expect(result!.indent).toBe('\t');
        });

        it('parses asterisk marker', () => {
            const result = TaskLineClassifier.classify('* [ ] star task');
            expect(result).not.toBeNull();
            expect(result!.rawContent).toBe('star task');
        });

        it('parses plus marker', () => {
            const result = TaskLineClassifier.classify('+ [ ] plus task');
            expect(result).not.toBeNull();
            expect(result!.rawContent).toBe('plus task');
        });

        it('parses numbered dot marker', () => {
            const result = TaskLineClassifier.classify('1. [ ] numbered task');
            expect(result).not.toBeNull();
            expect(result!.rawContent).toBe('numbered task');
        });

        it('parses numbered paren marker', () => {
            const result = TaskLineClassifier.classify('1) [ ] paren task');
            expect(result).not.toBeNull();
            expect(result!.rawContent).toBe('paren task');
        });

        it('parses multi-digit numbered marker', () => {
            const result = TaskLineClassifier.classify('42. [ ] item forty-two');
            expect(result).not.toBeNull();
            expect(result!.rawContent).toBe('item forty-two');
        });

        it('preserves prefix and suffix for round-trip', () => {
            const line = '  * [x] content after';
            const result = TaskLineClassifier.classify(line);
            expect(result).not.toBeNull();
            // Reconstruct via prefix + newChar + suffix
            const rebuilt = result!.prefix + 'X' + result!.suffix;
            expect(rebuilt).toBe('  * [X] content after');
        });

        it('returns null for non-task lines', () => {
            expect(TaskLineClassifier.classify('hello world')).toBeNull();
            expect(TaskLineClassifier.classify('- plain list')).toBeNull();
            expect(TaskLineClassifier.classify('# heading')).toBeNull();
            expect(TaskLineClassifier.classify('')).toBeNull();
        });

        it('returns null for checkbox without marker', () => {
            expect(TaskLineClassifier.classify('[x] no marker')).toBeNull();
        });

        it('handles various status chars', () => {
            for (const ch of [' ', 'x', 'X', '-', '!', '?', '/']) {
                const result = TaskLineClassifier.classify(`- [${ch}] task`);
                expect(result).not.toBeNull();
                expect(result!.statusChar).toBe(ch);
            }
        });
    });

    describe('isTaskLine', () => {
        it('returns true for valid task lines', () => {
            expect(TaskLineClassifier.isTaskLine('- [ ] task')).toBe(true);
            expect(TaskLineClassifier.isTaskLine('* [x] done')).toBe(true);
            expect(TaskLineClassifier.isTaskLine('+ [ ] plus')).toBe(true);
            expect(TaskLineClassifier.isTaskLine('1. [ ] numbered')).toBe(true);
        });

        it('returns false for non-task lines', () => {
            expect(TaskLineClassifier.isTaskLine('hello')).toBe(false);
            expect(TaskLineClassifier.isTaskLine('- list item')).toBe(false);
            expect(TaskLineClassifier.isTaskLine('')).toBe(false);
        });
    });

    describe('extractMarker', () => {
        it('extracts dash', () => {
            expect(TaskLineClassifier.extractMarker('- [ ] task')).toBe('-');
        });

        it('extracts asterisk', () => {
            expect(TaskLineClassifier.extractMarker('* [ ] task')).toBe('*');
        });

        it('extracts plus', () => {
            expect(TaskLineClassifier.extractMarker('+ [ ] task')).toBe('+');
        });

        it('extracts numbered dot', () => {
            expect(TaskLineClassifier.extractMarker('1. [ ] task')).toBe('1.');
        });

        it('extracts numbered paren', () => {
            expect(TaskLineClassifier.extractMarker('1) [ ] task')).toBe('1)');
        });

        it('extracts from indented line', () => {
            expect(TaskLineClassifier.extractMarker('    * [ ] task')).toBe('*');
        });

        it('falls back to dash for unrecognized', () => {
            expect(TaskLineClassifier.extractMarker('no marker here')).toBe('-');
            expect(TaskLineClassifier.extractMarker('')).toBe('-');
        });
    });

    describe('formatPrefix', () => {
        it('builds default prefix', () => {
            expect(TaskLineClassifier.formatPrefix(' ')).toBe('- [ ] ');
        });

        it('builds prefix with indent and marker', () => {
            expect(TaskLineClassifier.formatPrefix('x', '  ', '*')).toBe('  * [x] ');
        });

        it('builds prefix with numbered marker', () => {
            expect(TaskLineClassifier.formatPrefix(' ', '', '1.')).toBe('1. [ ] ');
        });
    });
});
