import { describe, it, expect } from 'vitest';
import { TaskLineClassifier } from '../../../src/services/parsing/utils/TaskLineClassifier';
import { readLine } from '../helpers/readLine';
import { type TaskLineFields, formatRow, formatTaskLine } from '../../../src/services/parsing/TaskLineFormat';

/**
 * A checkbox is a task to Obsidian only with a space or a tab after its `]`.
 * That gap is the checkbox's, not the content's: a line's content begins
 * after it, parts join one space apart with the empty ones left out, and a
 * block id is taken off the content. So a line the plugin writes is a task
 * however many of its parts are empty, and never carries a space too many.
 */
describe('TaskLineClassifier.splitContent', () => {
    it.each([
        ['- [ ] a', '- [ ] ', 'a'],
        ['	- [x] a b ', '	- [x] ', 'a b '],
        ['- [ ] ', '- [ ] ', ''],
        ['- [ ]		a', '- [ ]	', '	a'],
        ['- [ ]', '', '- [ ]'],
        ['	- item', '	', '- item'],
    ])('%j -> %j + %j', (line, head, content) => {
        expect(TaskLineClassifier.splitContent(line)).toEqual({ head, content });
    });
});

describe('TaskLineClassifier.joinContent', () => {
    it.each([
        [['a', '@2026-01-01', '', '^b'], 'a @2026-01-01 ^b'],
        [['', '', '', '^b'], '^b'],
        [['', '@2026-01-01'], '@2026-01-01'],
        [['a  ', ' '], 'a'],
        [['  a'], '  a'],
        [[], ''],
    ])('%j -> %j', (parts, expected) => {
        expect(TaskLineClassifier.joinContent(...parts)).toBe(expected);
    });
});

describe('formatTaskLine', () => {
    const format = (fields: Partial<TaskLineFields>) => formatTaskLine({ statusChar: ' ', content: '', ...fields });

    it('writes a task with nothing in it as `- [ ] `', () => {
        expect(format({})).toBe('- [ ] ');
    });

    it('writes one space between the checkbox and each part that is there', () => {
        expect(format({ startDate: '2026-01-01' })).toBe('- [ ] @2026-01-01');
        expect(format({ content: 'a', startDate: '2026-01-01' })).toBe('- [ ] a @2026-01-01');
    });

    it('writes the marker it is given, and `- ` without one', () => {
        expect(format({ content: 'a', marker: '1. ' })).toBe('1. [ ] a');
        expect(format({ content: 'a' })).toBe('- [ ] a');
    });

    it('reads back as the task it wrote, for every empty part', () => {
        for (const line of ['- [ ] ', '- [x] ^abc', '- [ ] @2026-01-01', '- [ ] ==> every mon', '- [ ] a ==> every mon ^abc']) {
            const task = readLine(line)!;
            expect(task).not.toBeNull();
            expect(formatRow(task)).toBe(line);
        }
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
