import { describe, it, expect } from 'vitest';
import { frameLink, frameLinkAt, frameTarget, frameTitle, readFrameContent } from '../../../src/services/data/MarkdownFrames';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { headingLinks } from '../../../src/services/parsing/utils/HeadingLinks';
import { DEFAULT_SETTINGS } from '../../../src/types';

const read = (lines: string[], subpath: string) => readFrameContent(lines, subpath, DEFAULT_SETTINGS);
/** The markdown of the section `subpath` names; undefined when the note has no such heading. */
const markdownOf = (lines: string[], subpath: string) => {
    const content = read(lines, subpath);
    return content.kind === 'no-heading' ? undefined : content.markdown;
};
const styleOf = (lines: string[], subpath: string) => {
    const content = read(lines, subpath);
    return content.kind === 'no-heading' ? undefined : [content.color, content.linestyle];
};

describe('the link of a markdown frame', () => {
    it('is cut at its first `#` into the note and the section', () => {
        expect(frameTarget('Folder/Note#Heading')).toEqual({ path: 'Folder/Note', subpath: '#Heading' });
        expect(frameTarget('Note#Parent#Child')).toEqual({ path: 'Note', subpath: '#Parent#Child' });
        expect(frameTarget('Dashboard')).toEqual({ path: 'Dashboard', subpath: '' });
    });

    it('is made of a note and the subpath of one of its headings, and cut back into them', () => {
        const links = headingLinks(Outline.read(['# Parent', '## Child', '# Other', '## Child']).headings);
        expect(frameLink('Folder/Note', links[1].subpath)).toBe('Folder/Note#Child');
        expect(frameLink('Folder/Note', links[3].subpath)).toBe('Folder/Note#Other#Child');
        expect(frameTarget(frameLink('Folder/Note', links[3].subpath))).toEqual({ path: 'Folder/Note', subpath: '#Other#Child' });
    });

    it('names the whole note without a subpath', () => {
        expect(frameLink('Folder/Note', null)).toBe('Folder/Note');
        expect(frameLink('Folder/Note', '')).toBe('Folder/Note');
    });
});

describe('the link of a frame whose note was renamed or moved', () => {
    it('names the note by its new path, without the extension, and keeps the section', () => {
        expect(frameLinkAt('Folder/Note#Memo', 'Other/Renamed.md')).toBe('Other/Renamed#Memo');
        expect(frameLinkAt('Folder/Note#Parent#Child', 'Renamed.md')).toBe('Renamed#Parent#Child');
    });

    it('names the whole note still, for a link that named the whole note', () => {
        expect(frameLinkAt('Folder/Note', 'Other/Renamed.md')).toBe('Other/Renamed');
        expect(frameLinkAt('Folder/Note#', 'Other/Renamed.md')).toBe('Other/Renamed');
    });

    it('writes the path whole where the link had a shorter name', () => {
        expect(frameLinkAt('Dashboard#Today', 'Home/Boards/Dashboard 2.md')).toBe('Home/Boards/Dashboard 2#Today');
    });

    it('is cut back into the new note and the same section', () => {
        const before = frameTarget('Folder/Note#Parent#Child');
        expect(frameTarget(frameLinkAt('Folder/Note#Parent#Child', 'A/B.md'))).toEqual({ path: 'A/B', subpath: before.subpath });
    });

    it('takes off only the extension at the end of the path', () => {
        expect(frameLinkAt('Note#H', 'a.md/b.md.md')).toBe('a.md/b.md#H');
    });
});

describe('the name the row of a frame shows', () => {
    const body = { markdown: '', color: null, linestyle: null };

    it('is the heading\'s text as the note writes it, for a heading\'s section', () => {
        expect(frameTitle('Folder/Note#bold link', { kind: 'heading', title: '**Bold** [[Link]]', ...body }, 'Note')).toBe('**Bold** [[Link]]');
    });

    it('is the note\'s name, for the whole note', () => {
        expect(frameTitle('Folder/Note', { kind: 'note', ...body }, 'Note')).toBe('Note');
        // A shorter name the link resolved: the note found names the row.
        expect(frameTitle('dash', { kind: 'note', ...body }, 'Dashboard')).toBe('Dashboard');
    });

    it('is the last heading the link names, when the section or the note is not there', () => {
        expect(frameTitle('Folder/Note#Parent#Child', { kind: 'no-heading' }, 'Note')).toBe('Child');
        expect(frameTitle('Folder/Note#Memo', { kind: 'no-note' }, null)).toBe('Memo');
    });

    it('is the last part of the note\'s path, when the link names no heading and the note is not there', () => {
        expect(frameTitle('Folder/Sub/Note', { kind: 'no-note' }, null)).toBe('Note');
        expect(frameTitle('Note', { kind: 'no-note' }, null)).toBe('Note');
        expect(frameTitle('Folder/Note#', { kind: 'no-note' }, null)).toBe('Note');
    });
});

describe('readFrameContent: the section of a heading', () => {
    it('shows the heading\'s text and the lines under it, deeper headings included, up to the next heading of its level or above', () => {
        const note = [
            '# Top',
            '## Today',
            'text',
            '### Detail',
            '- item',
            '',
            '## Tomorrow',
            'next',
            '# Other',
            'other',
        ];
        expect(read(note, '#Today')).toEqual({
            kind: 'heading', title: 'Today', markdown: 'text\n### Detail\n- item', color: null, linestyle: null,
        });
        expect(markdownOf(note, '#Tomorrow')).toBe('next');
        expect(markdownOf(note, '#Detail')).toBe('- item');
        expect(markdownOf(note, '#Top')).toBe('## Today\ntext\n### Detail\n- item\n\n## Tomorrow\nnext');
        expect(markdownOf(note, '#Other')).toBe('other');
    });

    it('finds the heading as a link does: named from a heading above it, case and marks aside, the first of two', () => {
        const note = ['# A', '## Memo', 'of a', '# B', '## Memo', 'of b', '## C: notes', 'c'];
        expect(markdownOf(note, '#Memo')).toBe('of a');
        expect(markdownOf(note, '#B#Memo')).toBe('of b');
        expect(markdownOf(note, 'B#memo')).toBe('of b');
        expect(read(note, '#c notes')).toMatchObject({ kind: 'heading', title: 'C: notes', markdown: 'c' });
    });

    it('shows the title as the note writes it, a closing run of `#` left out', () => {
        expect(read(['## **Bold** title ##', 'x'], '#bold title')).toMatchObject({ kind: 'heading', title: '**Bold** title' });
    });

    it('does not read a `## ` in a code block as a heading, and keeps it in the body', () => {
        const note = ['## A', '```md', '## not a heading', '```', 'after'];
        expect(markdownOf(note, '#A')).toBe('```md\n## not a heading\n```\nafter');
        expect(read(note, '#not a heading')).toEqual({ kind: 'no-heading' });
    });

    it('leaves out the section\'s property lines and the lines under them, those of a nested heading too', () => {
        const note = [
            '## A',
            '- tv-color:: teal',
            '- area::',
            '    - lab',
            '    - home',
            '',
            'text',
            '- [ ] task',
            '    - note:: of the task',
            '### Sub',
            '- tv-linestyle:: dashed',
            '',
            'sub text',
        ];
        expect(markdownOf(note, '#A')).toBe([
            'text',
            '- [ ] task',
            '    - note:: of the task',
            '### Sub',
            '',
            'sub text',
        ].join('\n'));
        expect(markdownOf(note, '#Sub')).toBe('sub text');
    });

    it('leaves out a line that goes on a property line\'s item with no blank line between', () => {
        expect(markdownOf(['## A', '- tv-color:: teal', 'goes on the item', '', 'text'], '#A')).toBe('text');
    });

    it('leaves out the blank lines at the two ends of the body, and keeps those inside it', () => {
        expect(markdownOf(['## A', '', '　', 'one', '', 'two', '', ' ', '## B'], '#A')).toBe('one\n\ntwo');
        expect(markdownOf(['## A', '', '', '## B'], '#A')).toBe('');
        expect(markdownOf(['## A'], '#A')).toBe('');
    });

    it('takes the style a task of the section inherits: the frontmatter, the lines above the first heading, the headings above, the section, the nearest winning', () => {
        const note = [
            '---',
            'tv-color: red',
            'tv-linestyle: dotted',
            '---',
            '- tv-linestyle:: dashed',
            '',
            '## Inherits',
            'a',
            '# Top',
            '- tv-color:: blue',
            '## Under top',
            'b',
            '## Own',
            '- tv-color:: teal',
            '### Sub',
            '- tv-color:: green',
        ];
        expect(styleOf(note, '#Inherits')).toEqual(['red', 'dashed']);
        expect(styleOf(note, '#Top')).toEqual(['blue', 'dashed']);
        expect(styleOf(note, '#Under top')).toEqual(['blue', 'dashed']);
        // A nested heading's property line styles the nested section, not the one around it.
        expect(styleOf(note, '#Own')).toEqual(['teal', 'dashed']);
        expect(styleOf(note, '#Sub')).toEqual(['green', 'dashed']);
    });

    it('takes no style where the nearest layer says there is none, and looks past a value that does not read', () => {
        const note = ['---', 'tv-color: red', 'tv-linestyle: dashed', '---', '## Hidden', '- tv-color::', '- tv-linestyle:: wavy'];
        expect(read(note, '#Hidden')).toEqual({ kind: 'heading', title: 'Hidden', markdown: '', color: null, linestyle: 'dashed' });
    });

    it('reads a tv-ignore\'d note as any other', () => {
        const note = ['---', 'tv-ignore: true', 'tv-color: red', '---', '## A', 'body'];
        expect(read(note, '#A')).toEqual({ kind: 'heading', title: 'A', markdown: 'body', color: 'red', linestyle: null });
    });

    it('says so when the note has no heading the subpath names', () => {
        const note = ['# A', '## B', 'text ^block', '# id'];
        expect(read(note, '#Missing')).toEqual({ kind: 'no-heading' });
        expect(read(note, '#B#A')).toEqual({ kind: 'no-heading' });
        expect(read(note, '#^block')).toEqual({ kind: 'no-heading' });
        expect(read(note, '#^id')).toEqual({ kind: 'no-heading' });
        expect(read([], '#A')).toEqual({ kind: 'no-heading' });
    });
});

describe('readFrameContent: the whole note', () => {
    it('shows the note past its frontmatter, with no title of its own', () => {
        const note = ['---', 'aliases: [x]', '---', '', 'intro', '# A', 'a', '## B', 'b', ''];
        expect(read(note, '')).toEqual({ kind: 'note', markdown: 'intro\n# A\na\n## B\nb', color: null, linestyle: null });
        expect(read(note, '')).not.toHaveProperty('title');
    });

    it('is what a subpath that writes no name asks for', () => {
        const note = ['intro', '# A', 'a'];
        expect(read(note, '#')).toEqual(read(note, ''));
        expect(read(note, '#').kind).toBe('note');
    });

    it('shows a note without a frontmatter from its first line, and an empty note as nothing', () => {
        expect(markdownOf(['one', 'two'], '')).toBe('one\ntwo');
        expect(read([], '')).toEqual({ kind: 'note', markdown: '', color: null, linestyle: null });
        expect(markdownOf(['---', 'a: 1', '---'], '')).toBe('');
    });

    it('leaves out the property lines of every section, and the blank lines at its two ends', () => {
        const note = [
            '---',
            'tv-color: red',
            '---',
            '',
            '- tv-linestyle:: dashed',
            '',
            'intro',
            '## A',
            '- tv-color:: teal',
            '',
            'a',
            '### Sub',
            '- area::',
            '    - lab',
            '',
            'sub',
            '',
        ];
        expect(markdownOf(note, '')).toBe('intro\n## A\n\na\n### Sub\n\nsub');
    });

    it('takes the style a task above the first heading inherits: the frontmatter and the property lines above the first heading', () => {
        const note = [
            '---',
            'tv-color: red',
            'tv-linestyle: dotted',
            '---',
            '- tv-linestyle:: dashed',
            '## A',
            '- tv-color:: teal',
        ];
        expect(styleOf(note, '')).toEqual(['red', 'dashed']);
        expect(styleOf(['- tv-color:: blue', 'text'], '')).toEqual(['blue', null]);
        expect(styleOf(['---', 'tv-color: red', '---', '- tv-color::', '# A'], '')).toEqual([null, null]);
    });

    it('reads a tv-ignore\'d note as any other', () => {
        const note = ['---', 'tv-ignore: true', 'tv-color: red', '---', 'intro', '## A', 'body'];
        expect(read(note, '')).toEqual({ kind: 'note', markdown: 'intro\n## A\nbody', color: 'red', linestyle: null });
    });
});
