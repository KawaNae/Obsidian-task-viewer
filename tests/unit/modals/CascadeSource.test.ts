import { describe, it, expect } from 'vitest';
import { CascadeSource } from '../../../src/modals/hub/CascadeSource';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { splitLines } from '../../../src/services/persistence/FileLines';
import { DEFAULT_SETTINGS } from '../../../src/types';

/** The rows of a note, as the index reads them. */
function rows(content: string) {
    const parsed = FileParsePipeline.parse('note.md', splitLines(content).lines, DEFAULT_SETTINGS, namesOutsideIndex('note.md'));
    return (name: string) => parsed.tasks.find(task => task.content === name)!;
}

// The hub says where an inherited value is written from the record the
// reading kept beside the row (`inheritedFrom`), not from the metadata cache.
describe('CascadeSource', () => {
    const task = rows([
        '---',
        'Tags: [both, file]',
        'tv-color: red',
        'owner: me',
        '---',
        '## Section',
        '- tags:: #both #sec',
        '- tv-mask:: ***',
        '- owner:: you',
        '- [ ] row',
        '- [ ] own',
        '    - tv-mask:: ---',
        '### Hidden',
        '- tv-color::',
        '- [ ] under hidden',
        '- [ ] own none',
        '    - tv-color::',
    ].join('\n'));

    it('says a tag is the file\'s when the frontmatter adds it, the topmost layer that does', () => {
        expect(CascadeSource.forTag(task('row'), 'file')).toBe('file');
        expect(CascadeSource.forTag(task('row'), 'both')).toBe('file');
        expect(CascadeSource.forTag(task('row'), 'sec')).toBe('section');
    });

    it('says a style is the layer\'s that won it, whether or not the row has its own', () => {
        expect(CascadeSource.forField(task('row'), 'color')).toBe('file');
        expect(CascadeSource.forField(task('row'), 'mask')).toBe('section');
        expect(CascadeSource.forField(task('row'), 'linestyle')).toBeNull();
        expect(CascadeSource.forField(task('own'), 'mask')).toBe('section');
    });

    it('says an inherited no value is the layer\'s that hid it, under a row\'s own no value too', () => {
        expect(task('under hidden').cascadeContext?.color).toBeUndefined();
        expect(CascadeSource.forField(task('under hidden'), 'color')).toBe('section');
        expect(CascadeSource.lineOfField(task('under hidden'), 'color', 'tv-color')).toEqual({ line: 13 });
        expect(CascadeSource.forField(task('own none'), 'color')).toBe('section');
    });

    it('says a property is the layer\'s that won it', () => {
        expect(CascadeSource.forProperty(task('row'), 'owner')).toBe('section');
    });

    it('gives the line a value is written on, a frontmatter key with its key', () => {
        expect(CascadeSource.lineOfField(task('row'), 'color', 'tv-color')).toEqual({ line: 2, frontmatterKey: 'tv-color' });
        expect(CascadeSource.lineOfField(task('row'), 'mask', 'tv-mask')).toEqual({ line: 7 });
        expect(CascadeSource.lineOfField(task('row'), 'linestyle', 'tv-linestyle')).toBeNull();
        expect(CascadeSource.lineOfTag(task('row'), 'sec')).toEqual({ line: 6 });
        expect(CascadeSource.lineOfTag(task('row'), 'file')).toEqual({ line: 1, frontmatterKey: 'tags' });
        expect(CascadeSource.lineOfProperty(task('row'), 'OWNER')).toEqual({ line: 8 });
    });

    it('says a value above the first heading is the file\'s, as the frontmatter\'s is, and opens its line', () => {
        const root = rows([
            '---',
            'tv-color: red',
            '---',
            'Inherit properties:',
            '- 時給:: 1450',
            '- tv-mask:: ***',
            '- tags:: #top',
            '## Section',
            '- tv-color:: blue',
            '- [ ] under',
        ].join('\n'));
        expect(CascadeSource.forProperty(root('under'), '時給')).toBe('file');
        expect(CascadeSource.forField(root('under'), 'mask')).toBe('file');
        expect(CascadeSource.forField(root('under'), 'color')).toBe('section');
        expect(CascadeSource.forTag(root('under'), 'top')).toBe('file');
        expect(CascadeSource.lineOfProperty(root('under'), '時給')).toEqual({ line: 4 });
        expect(CascadeSource.lineOfField(root('under'), 'mask', 'tv-mask')).toEqual({ line: 5 });
        expect(CascadeSource.lineOfTag(root('under'), 'top')).toEqual({ line: 6 });
    });

    it('opens the line a date and its time are given on by the date\'s key', () => {
        const dated = rows([
            '---',
            'tv-start: 2026-03-01 09:00',
            '---',
            '## Section',
            '- tv-end:: 2026-03-02 10:00',
            '- [ ] dated',
        ].join('\n'));
        expect(CascadeSource.forField(dated('dated'), 'startTime')).toBe('file');
        expect(CascadeSource.lineOfField(dated('dated'), 'startTime', 'tv-start')).toEqual({ line: 1, frontmatterKey: 'tv-start' });
        expect(CascadeSource.lineOfField(dated('dated'), 'endTime', 'tv-end')).toEqual({ line: 4 });
        expect(CascadeSource.lineOfField(dated('dated'), 'due', 'tv-due')).toBeNull();
    });

    it('labels a value of the note as the file\'s, and one of a heading\'s section as the section\'s', () => {
        expect(CascadeSource.label('file')).toBe('inherited: file');
        expect(CascadeSource.label('section')).toBe('inherited: section');
    });
});
