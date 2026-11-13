import { describe, it, expect } from 'vitest';
import { frameLink, frameLinkAt, frameTarget, frameTitle, readFrameContent } from '../../../src/services/data/MarkdownFrames';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { headingLinks } from '../../../src/services/parsing/utils/HeadingLinks';
import { DEFAULT_SETTINGS } from '../../../src/types';

const read = (lines: string[], subpath: string) => readFrameContent(lines, subpath, DEFAULT_SETTINGS);
/** The cards of the section `subpath` names; undefined when the note has no such heading. */
const cardsOf = (lines: string[], subpath: string) => {
    const content = read(lines, subpath);
    return content.kind === 'no-heading' ? undefined : content.cards;
};
/** Each card's markdown. */
const markdownOf = (lines: string[], subpath: string) => cardsOf(lines, subpath)?.map(card => card.markdown);
/** Each card's color and line style. */
const styleOf = (lines: string[], subpath: string) => cardsOf(lines, subpath)?.map(card => [card.color, card.linestyle]);
/** Each card's mask. */
const maskOf = (lines: string[], subpath: string) => cardsOf(lines, subpath)?.map(card => card.mask);
/** A card of no style and no mask. */
const plain = (heading: string | null, markdown: string) => ({ heading, markdown, color: null, linestyle: null, mask: null });

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
    const body = { cards: [plain(null, '')] };

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
    it('cuts the section into the lines under its heading and a card for each heading nested one level in it, which holds the deeper ones', () => {
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
            kind: 'heading',
            title: 'Today',
            cards: [plain(null, 'text'), plain('### Detail', '### Detail\n- item')],
        });
        expect(markdownOf(note, '#Tomorrow')).toEqual(['next']);
        expect(markdownOf(note, '#Detail')).toEqual(['- item']);
        expect(markdownOf(note, '#Top')).toEqual(['## Today\ntext\n### Detail\n- item', '## Tomorrow\nnext']);
        expect(markdownOf(note, '#Other')).toEqual(['other']);
    });

    it('starts a card at the first heading under the section\'s, whatever its level, and the next at the next heading of its level or above', () => {
        const note = ['# Top', '#### Deep', 'd', '### Mid', 'm', '#### Under mid', 'u', '## High', 'h'];
        expect(cardsOf(note, '#Top')?.map(card => card.heading)).toEqual(['#### Deep', '### Mid', '## High']);
        expect(markdownOf(note, '#Top')).toEqual(['#### Deep\nd', '### Mid\nm\n#### Under mid\nu', '## High\nh']);
    });

    it('draws the lines under the section\'s heading only when something is left of them, and a nested heading\'s card even when it is empty', () => {
        const note = ['# Top', '', '- tv-color:: teal', '', '## A', '## B', '- tv-color:: red', '', '## C', 'c'];
        expect(cardsOf(note, '#Top')?.map(card => [card.heading, card.markdown])).toEqual([
            ['## A', '## A'],
            ['## B', '## B'],
            ['## C', '## C\nc'],
        ]);
        expect(markdownOf(['# Top', 'intro', '## A'], '#Top')).toEqual(['intro', '## A']);
    });

    it('is one card for a section with no heading in it, an empty one too', () => {
        expect(read(['## A', '- tv-color:: teal'], '#A')).toEqual({ kind: 'heading', title: 'A', cards: [{ ...plain(null, ''), color: 'teal' }] });
        expect(markdownOf(['## A'], '#A')).toEqual(['']);
    });

    it('opens a card with its heading\'s lines, a setext heading\'s two', () => {
        const note = ['# Top', 'Under', '---', 'u'];
        expect(cardsOf(note, '#Top')?.map(card => [card.heading, card.markdown])).toEqual([['Under\n---', 'Under\n---\nu']]);
    });

    it('finds the heading as a link does: named from a heading above it, case and marks aside, the first of two', () => {
        const note = ['# A', '## Memo', 'of a', '# B', '## Memo', 'of b', '## C: notes', 'c'];
        expect(markdownOf(note, '#Memo')).toEqual(['of a']);
        expect(markdownOf(note, '#B#Memo')).toEqual(['of b']);
        expect(markdownOf(note, 'B#memo')).toEqual(['of b']);
        expect(read(note, '#c notes')).toEqual({ kind: 'heading', title: 'C: notes', cards: [plain(null, 'c')] });
    });

    it('shows the title as the note writes it, a closing run of `#` left out', () => {
        expect(read(['## **Bold** title ##', 'x'], '#bold title')).toMatchObject({ kind: 'heading', title: '**Bold** title' });
    });

    it('does not read a `## ` in a code block as a heading, and keeps it in the card', () => {
        const note = ['## A', '```md', '## not a heading', '```', 'after'];
        expect(markdownOf(note, '#A')).toEqual(['```md\n## not a heading\n```\nafter']);
        expect(read(note, '#not a heading')).toEqual({ kind: 'no-heading' });
    });

    it('leaves out the property lines of a card\'s section and of those nested in it, and the lines under them', () => {
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
            '#### Deeper',
            '- tv-mask:: deep',
            '',
            'deeper text',
        ];
        expect(markdownOf(note, '#A')).toEqual([
            'text\n- [ ] task\n    - note:: of the task',
            '### Sub\n\nsub text\n#### Deeper\n\ndeeper text',
        ]);
        expect(markdownOf(note, '#Sub')).toEqual(['sub text', '#### Deeper\n\ndeeper text']);
    });

    it('leaves out a line that goes on a property line\'s item with no blank line between', () => {
        expect(markdownOf(['## A', '- tv-color:: teal', 'goes on the item', '', 'text'], '#A')).toEqual(['text']);
    });

    it('leaves out the blank lines at the two ends of a card, and keeps those inside it', () => {
        expect(markdownOf(['## A', '', '　', 'one', '', 'two', '', ' ', '## B'], '#A')).toEqual(['one\n\ntwo']);
        expect(markdownOf(['# T', '', '## A', '', 'one', '', 'two', '', '## B', ''], '#T')).toEqual(['## A\n\none\n\ntwo', '## B']);
        expect(markdownOf(['## A', '', '', '## B'], '#A')).toEqual(['']);
    });

    it('styles each card as a task of its section is: the frontmatter, the lines above the first heading, the headings above, its section, the nearest winning', () => {
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
            '',
            'top',
            '## Under top',
            'b',
            '## Own',
            '- tv-color:: teal',
            '### Sub',
            '- tv-color:: green',
        ];
        expect(styleOf(note, '#Inherits')).toEqual([['red', 'dashed']]);
        expect(styleOf(note, '#Top')).toEqual([['blue', 'dashed'], ['blue', 'dashed'], ['teal', 'dashed']]);
        expect(styleOf(note, '#Under top')).toEqual([['blue', 'dashed']]);
        // A property line of a heading deeper than the card's styles the deeper section, not the card.
        expect(styleOf(note, '#Own')).toEqual([['green', 'dashed']]);
        expect(styleOf(note, '#Sub')).toEqual([['green', 'dashed']]);
    });

    it('takes no style where the nearest layer says there is none, and looks past a value that does not read', () => {
        const note = ['---', 'tv-color: red', 'tv-linestyle: dashed', '---', '## Hidden', '- tv-color::', '- tv-linestyle:: wavy'];
        expect(read(note, '#Hidden')).toEqual({ kind: 'heading', title: 'Hidden', cards: [{ ...plain(null, ''), linestyle: 'dashed' }] });
    });

    it('masks each card as a task of its section is masked: its own line, a heading above, the frontmatter, the lines above the first heading', () => {
        const note = [
            '---',
            'tv-mask: from frontmatter',
            '---',
            '## Inherits',
            'a',
            '# Top',
            '- tv-mask:: from top',
            '## Under top',
            'b',
            '## Own',
            '- tv-mask:: own',
            '### Sub',
            '- tv-mask:: from sub',
            '#### Deep',
            '- tv-mask:: from deep',
        ];
        expect(maskOf(note, '#Inherits')).toEqual(['from frontmatter']);
        expect(maskOf(note, '#Top')).toEqual(['from top', 'own']);
        expect(maskOf(note, '#Under top')).toEqual(['from top']);
        // A mask of a heading deeper than the card's masks the deeper section, not the card.
        expect(maskOf(note, '#Own')).toEqual(['from sub']);
        expect(maskOf(note, '#Sub')).toEqual(['from deep']);
        expect(maskOf(['- tv-mask:: from above', '', '## A', 'a'], '#A')).toEqual(['from above']);
        expect(maskOf(['## A', 'a'], '#A')).toEqual([null]);
    });

    it('takes no mask where the nearest layer hides it with no value', () => {
        const note = ['---', 'tv-mask: secret', '---', '# Top', 'top', '## Hidden', '- tv-mask::', '', 'text'];
        expect(maskOf(note, '#Top')).toEqual(['secret', null]);
        expect(read(note, '#Hidden')).toEqual({ kind: 'heading', title: 'Hidden', cards: [plain(null, 'text')] });
    });

    it('reads a tv-ignore\'d note as any other', () => {
        const note = ['---', 'tv-ignore: true', 'tv-color: red', '---', '## A', 'body'];
        expect(read(note, '#A')).toEqual({ kind: 'heading', title: 'A', cards: [{ ...plain(null, 'body'), color: 'red' }] });
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
    it('cuts the note past its frontmatter into the lines above its first heading and a card for each heading no other is above, with no title of its own', () => {
        const note = ['---', 'aliases: [x]', '---', '', 'intro', '## A', 'a', '### Sub', 's', '## B', 'b', ''];
        expect(read(note, '')).toEqual({ kind: 'note', cards: [plain(null, 'intro'), plain('## A', '## A\na\n### Sub\ns'), plain('## B', '## B\nb')] });
        expect(read(note, '')).not.toHaveProperty('title');
    });

    it('is one card for a note headed by a single `#`, whose sections the frame of that heading cuts', () => {
        const note = ['# Title', '## A', 'a', '## B', 'b'];
        expect(markdownOf(note, '')).toEqual(['# Title\n## A\na\n## B\nb']);
        expect(markdownOf(note, '#Title')).toEqual(['## A\na', '## B\nb']);
    });

    it('is what a subpath that writes no name asks for', () => {
        const note = ['intro', '# A', 'a'];
        expect(read(note, '#')).toEqual(read(note, ''));
        expect(read(note, '#').kind).toBe('note');
    });

    it('shows a note without a frontmatter from its first line, and an empty note as one empty card', () => {
        expect(markdownOf(['one', 'two'], '')).toEqual(['one\ntwo']);
        expect(read([], '')).toEqual({ kind: 'note', cards: [plain(null, '')] });
        expect(markdownOf(['---', 'a: 1', '---'], '')).toEqual(['']);
        expect(markdownOf(['---', 'a: 1', '---', '', '- tv-color:: red', '## A'], '')).toEqual(['## A']);
    });

    it('leaves out the property lines of every section, and the blank lines at each card\'s two ends', () => {
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
        expect(markdownOf(note, '')).toEqual(['intro', '## A\n\na\n### Sub\n\nsub']);
    });

    it('styles the card above the first heading as a task written there, and each heading\'s card as a task of its section', () => {
        const note = [
            '---',
            'tv-color: red',
            'tv-linestyle: dotted',
            '---',
            '- tv-linestyle:: dashed',
            '',
            'intro',
            '## A',
            '- tv-color:: teal',
            '## B',
        ];
        expect(styleOf(note, '')).toEqual([['red', 'dashed'], ['teal', 'dashed'], ['red', 'dashed']]);
        expect(styleOf(['- tv-color:: blue', 'text'], '')).toEqual([['blue', null]]);
        expect(styleOf(['---', 'tv-color: red', '---', '- tv-color::', '# A'], '')).toEqual([[null, null]]);
    });

    it('masks the card above the first heading as a task written there, and each heading\'s card as a task of its section', () => {
        expect(maskOf(['---', 'tv-mask: secret', '---', '- tv-mask:: above', '', 'intro', '## A', '- tv-mask:: a', '## B'], '')).toEqual(['above', 'a', 'above']);
        expect(maskOf(['---', 'tv-mask: secret', '---', 'intro', '## A', '- tv-mask:: a'], '')).toEqual(['secret', 'a']);
        expect(maskOf(['intro', '## A', '- tv-mask:: a'], '')).toEqual([null, 'a']);
        expect(maskOf(['---', 'tv-mask: secret', '---', '- tv-mask::', '# A'], '')).toEqual([null]);
    });

    it('reads a tv-ignore\'d note as any other', () => {
        const note = ['---', 'tv-ignore: true', 'tv-color: red', '---', 'intro', '## A', 'body'];
        expect(read(note, '')).toEqual({ kind: 'note', cards: [{ ...plain(null, 'intro'), color: 'red' }, { ...plain('## A', '## A\nbody'), color: 'red' }] });
    });
});
