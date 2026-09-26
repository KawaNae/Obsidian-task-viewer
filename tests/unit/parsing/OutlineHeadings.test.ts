import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';

/**
 * The headings of a note, as the one reading of its blocks reads them
 * (`OutlineReading.headings`): CommonMark's, at the top of the note only —
 * an ATX heading indented up to three columns, and a paragraph a line of `=`
 * or `-` underlines. Not a heading in an item, a fence, indented code, a
 * quote or the frontmatter (Obsidian links to none of those, F8's Dev
 * measurement).
 */
const headingsOf = (text: string) => Outline.read(text.split('\n')).headings
    .map(h => ({ line: h.line, end: h.end, level: h.level, text: h.text }));

describe('OutlineReading.headings', () => {
    it('reads an ATX heading at the top, up to three columns in', () => {
        expect(headingsOf('# A\n   ## B\n    ## C')).toEqual([
            { line: 0, end: 1, level: 1, text: 'A' },
            { line: 1, end: 2, level: 2, text: 'B' },
        ]);
    });

    it('takes the closing run of `#` off the name, and only when a space stands before it', () => {
        expect(headingsOf('## D ##\n## E#\n##\n### ###\n#\tTab  ')).toEqual([
            { line: 0, end: 1, level: 2, text: 'D' },
            { line: 1, end: 2, level: 2, text: 'E#' },
            { line: 2, end: 3, level: 2, text: '' },
            { line: 3, end: 4, level: 3, text: '' },
            { line: 4, end: 5, level: 1, text: 'Tab' },
        ]);
    });

    it('does not read seven `#` or a tag as a heading', () => {
        expect(headingsOf('####### seven\n#tag')).toEqual([]);
    });

    it('reads a setext heading from its paragraph to its underline', () => {
        expect(headingsOf('Foo\n===\n\nBar\n  baz\n---')).toEqual([
            { line: 0, end: 2, level: 1, text: 'Foo' },
            { line: 3, end: 6, level: 2, text: 'Bar baz' },
        ]);
    });

    it('reads a `---` after a blank line as a rule, not an underline', () => {
        expect(headingsOf('Foo\n\n---')).toEqual([]);
    });

    it('reads no heading in the frontmatter or a fence', () => {
        expect(headingsOf('---\ntitle: x\n---\n```\n# x\n```\n# y')).toEqual([
            { line: 6, end: 7, level: 1, text: 'y' },
        ]);
    });

    it('reads no heading inside an item, and one at column 0 below it', () => {
        expect(headingsOf('- [ ] T\n  ## X\n  ---\n## Y')).toEqual([
            { line: 3, end: 4, level: 2, text: 'Y' },
        ]);
    });

    it('reads no heading from an underline below an item\'s lazy line', () => {
        expect(headingsOf('- [ ] T\nlazy\n===')).toEqual([]);
    });

    it('reads no heading in a quote', () => {
        expect(headingsOf('> ## Q\n> Foo\n> ===')).toEqual([]);
    });
});
