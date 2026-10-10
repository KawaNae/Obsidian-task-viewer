import { describe, it, expect } from 'vitest';
import { headingSubpath, noteLink, pickedLink, type PickedTarget } from '../../../src/utils/NoteLink';
import { linkApp, linkFile } from '../helpers/linkApp';
import { linkDouble, type LinkSettings } from '../helpers/linkDouble';
import { makeFile } from '../helpers/vaultSession';

/**
 * A link to a file, under each of the link settings measured at stage 0
 * (`archive/2026-09-stages/3-v058-2026-09-28.md`, s0-measure, リンクの生成), through a stand-in that
 * spells links as Obsidian was measured to (`linkDouble`). What is asserted
 * is what `noteLink` hands Obsidian: the file, the note the link is written
 * in, the subpath and the display text. The link a sent row is left with
 * shows the note's name (`SendWriter`).
 *
 * And the link Obsidian's `[[` writes for a candidate picked (`pickedLink`),
 * through an app whose `fileToLinktext` names a file by the shortest path
 * (`linkApp`).
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

describe('pickedLink: what Obsidian\'s [[ writes for a candidate picked', () => {
    const FILES = ['src.md', 'a/Dup.md', 'b/Dup.md', 'Unique.md', 'a/画像.png', 'b/画像.png', 'one.png', 'a/doc.pdf', 'b/doc.pdf', 'solo.pdf', 'with space.md'];
    const at = (markdown: boolean) => {
        const app = linkApp({ files: FILES, markdown });
        return (target: PickedTarget) => pickedLink(app, target, 'src.md');
    };
    const file = (path: string) => linkFile(path);

    describe('wikilinks', () => {
        const link = at(false);

        it('a file the shortest path names by its name: the name alone', () => {
            expect(link({ kind: 'file', file: file('Unique.md') })).toBe('[[Unique]]');
            expect(link({ kind: 'file', file: file('one.png') })).toBe('[[one.png]]');
            expect(link({ kind: 'file', file: file('solo.pdf') })).toBe('[[solo.pdf]]');
        });

        it('a file named by its path: a note or a PDF shows its name, an image nothing', () => {
            expect(link({ kind: 'file', file: file('a/Dup.md') })).toBe('[[a/Dup|Dup]]');
            expect(link({ kind: 'file', file: file('a/doc.pdf') })).toBe('[[a/doc.pdf|doc]]');
            expect(link({ kind: 'file', file: file('a/画像.png') })).toBe('[[a/画像.png]]');
        });

        it('an alias shows itself after its note', () => {
            expect(link({ kind: 'alias', file: file('Unique.md'), alias: '別名' })).toBe('[[Unique|別名]]');
            expect(link({ kind: 'alias', file: file('a/Dup.md'), alias: '別名' })).toBe('[[a/Dup|別名]]');
        });

        it('an unresolved link: its target as it is', () => {
            expect(link({ kind: 'unresolved', linkpath: 'Ideas/Later' })).toBe('[[Ideas/Later]]');
        });

        it('a heading: the note as typed, and the heading; in its own note, the heading alone', () => {
            expect(link({ kind: 'heading', file: file('Unique.md'), linkpath: 'uniq', heading: '見出し' })).toBe('[[uniq#見出し]]');
            expect(link({ kind: 'heading', file: file('src.md'), linkpath: '', heading: '見出し' })).toBe('[[#見出し]]');
        });

        it('a heading\'s characters a link cannot hold, as spaces', () => {
            expect(headingSubpath('a: b | c [[d]] %%e%% ^f\\g')).toBe('a b c d e f g');
            expect(link({ kind: 'heading', file: file('Unique.md'), linkpath: 'Unique', heading: '1. 準備: 道具' })).toBe('[[Unique#1. 準備 道具]]');
        });
    });

    describe('Markdown links', () => {
        const link = at(true);

        it('show the file\'s name, the alias, the target or the heading; the path with its spaces encoded', () => {
            expect(link({ kind: 'file', file: file('with space.md') })).toBe('[with space](with%20space.md)');
            expect(link({ kind: 'file', file: file('a/画像.png') })).toBe('[画像](a/画像.png)');
            expect(link({ kind: 'alias', file: file('Unique.md'), alias: '別名' })).toBe('[別名](Unique.md)');
            expect(link({ kind: 'unresolved', linkpath: 'Later note' })).toBe('[Later note](Later%20note)');
        });

        it('a heading names its note as typed, with .md', () => {
            expect(link({ kind: 'heading', file: file('Unique.md'), linkpath: 'Unique', heading: '見出し' })).toBe('[見出し](Unique.md#見出し)');
            expect(link({ kind: 'heading', file: file('src.md'), linkpath: '', heading: '見出し' })).toBe('[見出し](#見出し)');
        });
    });
});
