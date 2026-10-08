import { describe, it, expect } from 'vitest';
import { noteLink } from '../../../src/utils/NoteLink';
import { linkDouble, type LinkSettings } from '../helpers/linkDouble';
import { makeFile } from '../helpers/vaultSession';

/**
 * A link to a file, under each of the link settings measured at stage 0
 * (`archive/2026-09-stages/3-v058-2026-09-28.md`, s0-measure, リンクの生成), through a stand-in that
 * spells links as Obsidian was measured to (`linkDouble`). What is asserted
 * is what `noteLink` hands Obsidian: the file, the note the link is written
 * in, the subpath and the display text. The link a sent row is left with
 * shows the note's name (`SendWriter`); a candidate of `[[` shows its name,
 * an alias, or, into a heading, nothing (`note-suggest/candidates.md`).
 */
const NOTES = [
    '_s0-measure/報告書.md',
    '_s0-measure/sub/Unique.md',
    '_s0-measure/d1/Dup.md',
    '_s0-measure/d2/Dup.md',
    '_s0-measure/sub/with space.md',
];

function linkUnder(settings: LinkSettings) {
    const fileManager = { generateMarkdownLink: linkDouble(() => NOTES, settings) };
    return (target: string, source: string) => {
        const file = makeFile(target);
        return noteLink(fileManager, file, source, { display: file.basename });
    };
}

const SRC = '_s0-measure/src.md';

describe('noteLink: wikilinks, the shortest path (the default)', () => {
    const link = linkUnder({ newLinkFormat: 'shortest', useMarkdownLinks: false });

    it('a note no other shares the name of: its name alone', () => {
        expect(link('_s0-measure/報告書.md', SRC)).toBe('[[報告書]]');
        expect(link('_s0-measure/sub/Unique.md', 'DailyNotes/x.md')).toBe('[[Unique]]');
        expect(link('_s0-measure/sub/with space.md', SRC)).toBe('[[with space]]');
    });

    it('a note another shares the name of: its path, showing its name', () => {
        expect(link('_s0-measure/d1/Dup.md', SRC)).toBe('[[_s0-measure/d1/Dup|Dup]]');
    });

});

describe('noteLink: wikilinks, the relative path', () => {
    const link = linkUnder({ newLinkFormat: 'relative', useMarkdownLinks: false });

    it('seen from the note the row is in', () => {
        expect(link('_s0-measure/報告書.md', SRC)).toBe('[[報告書]]');
        expect(link('_s0-measure/sub/Unique.md', SRC)).toBe('[[sub/Unique|Unique]]');
        expect(link('_s0-measure/報告書.md', '_s0-measure/sub/other.md')).toBe('[[../報告書|報告書]]');
        expect(link('_s0-measure/報告書.md', 'DailyNotes/x.md')).toBe('[[../_s0-measure/報告書|報告書]]');
    });
});

describe('noteLink: wikilinks, the absolute path', () => {
    const link = linkUnder({ newLinkFormat: 'absolute', useMarkdownLinks: false });

    it('the path from the root, showing the name', () => {
        expect(link('_s0-measure/報告書.md', SRC)).toBe('[[_s0-measure/報告書|報告書]]');
    });
});

describe('noteLink: Markdown links', () => {
    const link = linkUnder({ newLinkFormat: 'shortest', useMarkdownLinks: true });

    it('show the name', () => {
        expect(link('_s0-measure/報告書.md', SRC)).toBe('[報告書](報告書.md)');
        expect(link('_s0-measure/sub/with space.md', SRC)).toBe('[with space](with%20space.md)');
        expect(link('_s0-measure/d1/Dup.md', SRC)).toBe('[Dup](_s0-measure/d1/Dup.md)');
    });
});

describe('noteLink: a display text and a subpath', () => {
    const fileManager = { generateMarkdownLink: linkDouble(() => NOTES) };
    const link = (target: string, opts: { subpath?: string; display?: string }) => noteLink(fileManager, makeFile(target), SRC, opts);

    it('an alias shown after the link, which names the note as the settings say', () => {
        expect(link('_s0-measure/報告書.md', { display: '別名' })).toBe('[[報告書|別名]]');
        expect(link('_s0-measure/d1/Dup.md', { display: '別名' })).toBe('[[_s0-measure/d1/Dup|別名]]');
    });

    it('none asked, none shown: a note another shares the name of is named by its path alone', () => {
        expect(link('_s0-measure/d1/Dup.md', {})).toBe('[[_s0-measure/d1/Dup]]');
    });

    it('a heading, shown as the link reads', () => {
        expect(link('_s0-measure/報告書.md', { subpath: '#見出し' })).toBe('[[報告書#見出し]]');
    });
});
