import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { headingLinks, headingNames, resolveHeading } from '../../../src/services/parsing/utils/HeadingLinks';

/**
 * A link to a heading, read off a note's lines (`resolveHeading`) and
 * written for each of its headings (`headingLinks`). The reading is the walk
 * of Obsidian's `resolveSubpath` over the headings the outline reads.
 */
const headingsOf = (note: string[]) => Outline.read(note).headings;
/** The lines of the heading `subpath` names and of the heading its section runs up to. */
const found = (note: string[], subpath: string) => {
    const linked = resolveHeading(headingsOf(note), subpath);
    return linked && { line: linked.heading.line, next: linked.next?.line ?? null };
};
const lineOf = (note: string[], subpath: string) => found(note, subpath)?.line ?? null;

describe('resolveHeading', () => {
    it('finds a heading by its name, at any level, with or without the first `#`', () => {
        const note = ['# A', 'text', '## B', '### C'];
        expect(lineOf(note, '#A')).toBe(0);
        expect(lineOf(note, '#B')).toBe(2);
        expect(lineOf(note, 'C')).toBe(3);
        expect(lineOf(note, '#D')).toBeNull();
    });

    it('finds a heading named from the headings above it, each deeper than the one before', () => {
        const note = ['# A', '## X', '# B', '## X', '### Y'];
        expect(lineOf(note, '#A#X')).toBe(1);
        expect(lineOf(note, '#B#X')).toBe(3);
        expect(lineOf(note, '#B#X#Y')).toBe(4);
        expect(lineOf(note, 'B#Y')).toBe(4);
    });

    it('of two headings of one name, finds the first', () => {
        const note = ['## X', 'one', '# A', '## X', '## X'];
        expect(lineOf(note, '#X')).toBe(0);
        expect(lineOf(note, '#A#X')).toBe(3);
    });

    it('compares names case aside, with their marks read as spaces', () => {
        const note = ['## Hello, World!', '## **Bold** `code`', '## a:b', '## [[Other]] note', "## it's a-b_c", '## ＡＢ'];
        expect(lineOf(note, '#hello world')).toBe(0);
        expect(lineOf(note, '#HELLO,   WORLD')).toBe(0);
        expect(lineOf(note, '#bold code')).toBe(1);
        expect(lineOf(note, '#A B')).toBe(2);
        expect(lineOf(note, '#other note')).toBe(3);
        expect(lineOf(note, "#It's A-B_C")).toBe(4);
        expect(lineOf(note, '#it s a b c')).toBeNull();
        expect(lineOf(note, '#ＡＢ')).toBe(5);
        expect(lineOf(note, '#AB')).toBeNull();
    });

    it('finds a child below its parent and deeper than it, whether or not it stands in the parent\'s section', () => {
        const note = ['# A', '## Other', '# B', '## Child'];
        // `Child` is under `B`: `A` has none, and the walk goes on past `A`'s section.
        expect(lineOf(note, '#A#Child')).toBe(3);
        expect(lineOf(note, '#B#Child')).toBe(3);
    });

    it('finds no child that is not deeper than its parent, or that stands above it', () => {
        expect(lineOf(['# A', '# B'], '#A#B')).toBeNull();
        expect(lineOf(['## A', '# B'], '#A#B')).toBeNull();
        expect(lineOf(['## B', '# A'], '#A#B')).toBeNull();
        expect(lineOf(['# A', '## B'], '#B#A')).toBeNull();
        expect(lineOf(['# A', '## B'], '#A#B#C')).toBeNull();
    });

    it('reads no heading in a code block, an item or the frontmatter', () => {
        const note = ['---', 'title: x', '# Front', '---', '```md', '## Fenced', '```', '- item', '  ## In item', '## Real'];
        expect(lineOf(note, '#Front')).toBeNull();
        expect(lineOf(note, '#Fenced')).toBeNull();
        expect(lineOf(note, '#In item')).toBeNull();
        expect(lineOf(note, '#Real')).toBe(9);
    });

    it('finds a heading a line of `=` or `-` underlines', () => {
        const note = ['Title', '=====', '', 'Sub', '---', 'text'];
        expect(found(note, '#Title#Sub')).toEqual({ line: 3, next: null });
    });

    it('names no heading by a subpath that writes no name', () => {
        const note = ['# A', '##', '## B'];
        expect(headingNames('')).toEqual([]);
        expect(headingNames('#')).toEqual([]);
        expect(headingNames('#A##B#')).toEqual(['A', 'B']);
        expect(lineOf(note, '')).toBeNull();
        expect(lineOf(note, '#')).toBeNull();
        expect(lineOf(note, '##')).toBeNull();
        expect(lineOf(note, '#A##B')).toBe(2);
    });

    it('names no heading by a block id or a footnote, though a heading has the name', () => {
        const note = ['# id', '# 1', '# A', '## id'];
        expect(lineOf(note, '#^id')).toBeNull();
        expect(lineOf(note, '#[^1]')).toBeNull();
        expect(lineOf(note, '#id')).toBe(0);
        // Only a subpath of one name is a block's: after a heading's name, `^id` is a name.
        expect(lineOf(note, '#A#^id')).toBe(3);
    });

    it('says where the section ends: at the next heading of its level or above', () => {
        const note = ['# A', '## B', '### C', 'text', '## D', '# E'];
        expect(found(note, '#A')).toEqual({ line: 0, next: 5 });
        expect(found(note, '#B')).toEqual({ line: 1, next: 4 });
        expect(found(note, '#C')).toEqual({ line: 2, next: 4 });
        expect(found(note, '#D')).toEqual({ line: 4, next: 5 });
        expect(found(note, '#E')).toEqual({ line: 5, next: null });
    });
});

describe('headingLinks', () => {
    const linksOf = (note: string[]) => headingLinks(headingsOf(note)).map(link => link.subpath);

    it('names a heading by its own name when no heading above it in the note has it', () => {
        const note = ['# A', '## B', '### C', '# D'];
        expect(linksOf(note)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('gives each heading with its text and its level, in the note\'s order', () => {
        const links = headingLinks(headingsOf(['# A', 'text', '### Deep', '## B']));
        expect(links.map(link => [link.heading.text, link.heading.level, link.heading.line])).toEqual([
            ['A', 1, 0], ['Deep', 3, 2], ['B', 2, 3],
        ]);
    });

    it('names a heading whose name an earlier one has from the headings it stands under', () => {
        expect(linksOf(['# A', '## X', '# B', '## X'])).toEqual(['A', 'X', 'B', 'B#X']);
        expect(linksOf(['# P', '## Q', '### X', '# P2', '## Q', '### X'])).toEqual(['P', 'Q', 'X', 'P2', 'P2#Q', 'P2#Q#X']);
        // The earlier one may be deeper, or stand under no heading.
        expect(linksOf(['### X', '# A', '## X'])).toEqual(['X', 'A', 'A#X']);
    });

    it('names no heading that an earlier one shares its name with, under headings of the same names', () => {
        expect(linksOf(['# A', '## X', '# A', '## X'])).toEqual(['A', 'X', null, null]);
        expect(linksOf(['## X', '## X', '# A', '## X', '## X'])).toEqual(['X', null, 'A', 'A#X', null]);
        // Named alike once their marks are read as spaces, and case aside.
        expect(linksOf(['## Plan: v2', '## plan v2'])).toEqual(['Plan v2', null]);
    });

    it('writes a name without what would cut a link', () => {
        const note = ['## C# notes | v2', '## [[Note]] and ^caret', '## 100%% sure', '## a\\b: c', '## Hello, World! (draft)'];
        expect(linksOf(note)).toEqual(['C notes v2', 'Note and caret', '100 sure', 'a b c', 'Hello, World! (draft)']);
    });

    it('names no heading nothing is left of', () => {
        expect(linksOf(['##', '## |', '## A'])).toEqual([null, null, 'A']);
        // Under one that has no name, a heading is named from the others above it.
        expect(linksOf(['# A', '## X', '# B', '## |', '### X'])).toEqual(['A', 'X', 'B', null, 'B#X']);
    });

    it('writes what is read back as the heading it was written for', () => {
        const notes = [
            ['# A', '## X', '# B', '## X', '### X', '# A', '## X'],
            ['## C# notes | v2', '# [[Note]]', '## c notes v2', '## ^caret', 'Setext', '---', '### `code` **bold**'],
            ['### Deep', '## Mid', '# Top', '## Mid', '### Deep', '### Deep'],
            ['# 見出し', '## メモ', '# 別の見出し', '## メモ', '## ^id', '## [^1]'],
        ];
        for (const note of notes) {
            const headings = headingsOf(note);
            for (const { heading, subpath } of headingLinks(headings)) {
                if (subpath === null) continue;
                expect(resolveHeading(headings, subpath)?.heading, `${note.join(' / ')}: ${subpath}`).toBe(heading);
                expect(resolveHeading(headings, `#${subpath}`)?.heading).toBe(heading);
            }
        }
    });

    it('names every heading but the later of two no link tells apart', () => {
        const note = ['# A', '## X', '# B', '## X', '### X', '# A', '## X'];
        expect(linksOf(note)).toEqual(['A', 'X', 'B', 'B#X', 'B#X#X', null, null]);
    });
});
