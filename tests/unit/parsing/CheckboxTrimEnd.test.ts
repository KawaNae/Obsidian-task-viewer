import { describe, it, expect } from 'vitest';
import { TaskLineClassifier } from '../../../src/services/parsing/utils/TaskLineClassifier';

/**
 * A checkbox is a task to Obsidian only with a space or a tab after its `]`.
 * `trimEnd`, `tidy` and `extractBlockId` trim a line's end, and keep that one
 * gap when nothing else follows the checkbox.
 */
describe('TaskLineClassifier.trimEnd', () => {
    it.each([
        ['- [ ] ', '- [ ] '],
        ['- [ ]  ', '- [ ] '],
        ['- [ ] a  ', '- [ ] a'],
        ['- [ ]', '- [ ]'],
    ])('%j -> %j', (input, expected) => {
        expect(TaskLineClassifier.trimEnd(input)).toBe(expected);
    });
});

describe('TaskLineClassifier.tidy', () => {
    it('takes off the indentation and keeps the gap: `\\t- [x] ` -> `- [x] `', () => {
        expect(TaskLineClassifier.tidy('\t- [x] ')).toBe('- [x] ');
    });

    it('trims a line with content as before', () => {
        expect(TaskLineClassifier.tidy('\t- [ ] a  ')).toBe('- [ ] a');
    });
});

describe('TaskLineClassifier.extractBlockId', () => {
    it('reads `- [ ] ^a` as `- [ ] ` and the id', () => {
        expect(TaskLineClassifier.extractLineBlockId('- [ ] ^a')).toEqual({ text: '- [ ] ', blockId: 'a' });
    });

    it('reads `- [ ] a ^b` as `- [ ] a` and the id', () => {
        expect(TaskLineClassifier.extractLineBlockId('- [ ] a ^b')).toEqual({ text: '- [ ] a', blockId: 'b' });
    });

    it('reads a content `a ^b` as `a` and the id', () => {
        expect(TaskLineClassifier.extractBlockId('a ^b')).toEqual({ text: 'a', blockId: 'b' });
    });

    it('reads a content that is the id alone as empty and the id', () => {
        expect(TaskLineClassifier.extractBlockId('^b')).toEqual({ text: '', blockId: 'b' });
        expect(TaskLineClassifier.extractBlockId('a^b')).toEqual({ text: 'a^b' });
    });

    it('keeps a tab gap: `- [ ]\\t^a` -> `- [ ]\\t`', () => {
        expect(TaskLineClassifier.extractLineBlockId('- [ ]\t^a')).toEqual({ text: '- [ ]\t', blockId: 'a' });
    });

    it('keeps the indentation of a line that is no task', () => {
        expect(TaskLineClassifier.extractLineBlockId('\t- item ^a')).toEqual({ text: '\t- item', blockId: 'a' });
        expect(TaskLineClassifier.extractLineBlockId('\t^a')).toEqual({ text: '\t', blockId: 'a' });
        expect(TaskLineClassifier.extractLineBlockId('- [ ]^a')).toEqual({ text: '- [ ]^a' });
    });
});
