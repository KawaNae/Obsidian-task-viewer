import { describe, it, expect } from 'vitest';
import { TaskLineClassifier } from '../../../src/services/parsing/utils/TaskLineClassifier';
import { TVInlineParser } from '../../../src/services/parsing/tv-inline/TVInlineParser';
import { createTempTask } from '../../../src/services/data/createTempTask';

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

describe('TVInlineParser.format', () => {
    const format = (fields: Parameters<typeof createTempTask>[0]) => new TVInlineParser().format(createTempTask(fields));

    it('writes a task with nothing in it as `- [ ] `', () => {
        expect(format({ id: 't' })).toBe('- [ ] ');
    });

    it('writes one space between the checkbox and each part that is there', () => {
        expect(format({ id: 't', startDate: '2026-01-01' })).toBe('- [ ] @2026-01-01');
        expect(format({ id: 't', content: 'a', startDate: '2026-01-01' })).toBe('- [ ] a @2026-01-01');
    });

    it('reads back as the task it wrote, for every empty part', () => {
        const parser = new TVInlineParser();
        for (const line of ['- [ ] ', '- [x] ^abc', '- [ ] @2026-01-01', '- [ ] ==> every mon', '- [ ] a ==> every mon ^abc']) {
            const task = parser.parse(line, 'n.md', 0)!;
            expect(task).not.toBeNull();
            expect(parser.format(task)).toBe(line);
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
