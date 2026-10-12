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

    it('says a style is the layer\'s that won it, and none for a row that has its own', () => {
        expect(CascadeSource.forStyleField(task('row'), 'color')).toBe('file');
        expect(CascadeSource.forStyleField(task('row'), 'mask')).toBe('section');
        expect(CascadeSource.forStyleField(task('row'), 'linestyle')).toBeNull();
        expect(CascadeSource.forStyleField(task('own'), 'mask')).toBeNull();
    });

    it('says an inherited no value is the layer\'s that hid it, and none for a row\'s own no value', () => {
        expect(task('under hidden').cascadeContext?.color).toBeUndefined();
        expect(CascadeSource.forStyleField(task('under hidden'), 'color')).toBe('section');
        expect(CascadeSource.lineOfStyleField(task('under hidden'), 'color', 'tv-color')).toEqual({ line: 13 });
        expect(CascadeSource.forStyleField(task('own none'), 'color')).toBeNull();
    });

    it('says a property is the layer\'s that won it', () => {
        expect(CascadeSource.forProperty(task('row'), 'owner')).toBe('section');
    });

    it('gives the line a value is written on, a frontmatter key with its key', () => {
        expect(CascadeSource.lineOfStyleField(task('row'), 'color', 'tv-color')).toEqual({ line: 2, frontmatterKey: 'tv-color' });
        expect(CascadeSource.lineOfStyleField(task('row'), 'mask', 'tv-mask')).toEqual({ line: 7 });
        expect(CascadeSource.lineOfStyleField(task('row'), 'linestyle', 'tv-linestyle')).toBeNull();
        expect(CascadeSource.lineOfTag(task('row'), 'sec')).toEqual({ line: 6 });
        expect(CascadeSource.lineOfTag(task('row'), 'file')).toEqual({ line: 1, frontmatterKey: 'tags' });
        expect(CascadeSource.lineOfProperty(task('row'), 'OWNER')).toEqual({ line: 8 });
    });
});
