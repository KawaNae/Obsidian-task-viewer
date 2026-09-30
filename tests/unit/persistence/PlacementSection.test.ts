import { describe, expect, it } from 'vitest';
import { Placement, type SectionSide, headingKey } from '../../../src/services/persistence/utils/Placement';
import { Outline } from '../../../src/services/parsing/utils/Outline';

/**
 * Where lines go in a section (`Placement.into`): the heading a `[[#name]]`
 * names, looked up as Obsidian resolves the link, and its head or its end.
 * A section, to a line put in it, runs to the next heading of any level.
 */
const spotIn = (side: SectionSide) => (lines: string[], name: string, head = '- [ ] m') => {
    const found = Placement.into(Outline.read(lines), { heading: name, side }, head);
    if (found.kind !== 'spot') throw new Error(`no spot: ${found.kind}`);
    return found.spot;
};
const endOf = spotIn('end');
const headOf = spotIn('head');

describe('headingKey', () => {
    it('compares as Obsidian does: case aside, ASCII marks but \' - _ read as a space, spaces run together, trimmed', () => {
        expect(headingKey('  Case  Mix ')).toBe('case mix');
        expect(headingKey('**bold** `code` ==hl==')).toBe(headingKey('bold code hl'));
        expect(headingKey('[[Other]]')).toBe('other');
        expect(headingKey('a:b')).toBe('a b');
        expect(headingKey("it's a-b_c")).toBe("it's a-b_c");
        expect(headingKey('ÄÖ')).toBe('äö');
    });
});

describe('Placement.heading', () => {
    it('finds the one heading of the name, as Obsidian compares names', () => {
        const lines = ['# Top', '## Done **now**', '- [ ] a'];
        expect(Placement.heading(Outline.read(lines), 'done now')).toEqual({ kind: 'one', heading: expect.objectContaining({ line: 1, level: 2 }) });
        expect(Placement.heading(Outline.read(lines), ' DONE  now ')).toMatchObject({ kind: 'one' });
    });

    it('answers none when no heading has the name, a heading-like line in a fence or an item aside', () => {
        const lines = ['```', '## Done', '```', '- [ ] a', '  ## Done'];
        expect(Placement.heading(Outline.read(lines), 'Done')).toEqual({ kind: 'none' });
    });

    it('answers how many when two or more headings have the name, whatever their levels and case', () => {
        const lines = ['## Case', '- [ ] a', '### case', 'Case', '---'];
        expect(Placement.heading(Outline.read(lines), 'CASE')).toEqual({ kind: 'many', count: 3 });
    });
});

describe('Placement.into', () => {
    it('answers none and many as the heading is looked up, at either side', () => {
        const lines = ['## Case', '- [ ] a', '### case', '## Other'];
        for (const side of ['head', 'end'] as const) {
            expect(Placement.into(Outline.read(lines), { heading: 'CASE', side }, '- [ ] m')).toEqual({ kind: 'many', count: 2 });
            expect(Placement.into(Outline.read(lines), { heading: 'Nope', side }, '- [ ] m')).toEqual({ kind: 'none' });
        }
    });

    it('finds a heading of any level by its name', () => {
        const lines = ['# Top', '### Tasks', '- [ ] a'];
        expect(headOf(lines, 'tasks').at).toBe(2);
        expect(endOf(lines, 'Tasks').at).toBe(3);
    });
});

describe('Placement.into, at the end', () => {
    it('is past the last line of the section, which runs to the next heading', () => {
        const lines = ['# A', '- [ ] a1', '## B', '- [ ] b1', '# C', '- [ ] c1'];
        expect(endOf(lines, 'A')).toEqual({ at: 2, parent: null, indent: '' });
        expect(endOf(lines, 'B')).toEqual({ at: 4, parent: null, indent: '' });
        expect(endOf(lines, 'C')).toEqual({ at: 6, parent: null, indent: '' });
    });

    it('stops at a deeper heading as at one of its own level: a line past it would read as the deeper one\'s', () => {
        const lines = ['## A', '- [ ] a1', '### Sub', '- tv-color:: gray', '- [ ] s1', '## B', '- [ ] b1'];
        expect(endOf(lines, 'A').at).toBe(2);
        expect(endOf(lines, 'Sub').at).toBe(5);
    });

    it('is just below the heading when a deeper heading follows it straight away', () => {
        expect(endOf(['## A', '### Sub', '- [ ] s1'], 'A').at).toBe(1);
        expect(endOf(['## A', '', '### Sub'], 'A').at).toBe(1);
    });

    it('is past the subtree of the last item, as its sibling, when the section ends in an item', () => {
        const lines = ['## D', '- [ ] d1', '    - [ ] d1c', '      text', '', '## E'];
        expect(endOf(lines, 'D')).toEqual({ at: 4, parent: null, indent: '' });
    });

    it('leaves the blank lines at the end of the section below what it puts', () => {
        const lines = ['## D', '- [ ] d1', '', '', '## E'];
        expect(endOf(lines, 'D').at).toBe(2);
    });

    it('is just below the heading when the section has nothing in it', () => {
        expect(endOf(['## F', '', '## G'], 'F').at).toBe(1);
        expect(endOf(['## F'], 'F').at).toBe(1);
    });

    it('is past a paragraph that ends the section', () => {
        expect(endOf(['## H', 'text', '', '## I'], 'H').at).toBe(2);
    });

    it('reads a setext heading as the section it opens', () => {
        const lines = ['Top', '===', '- [ ] x', '', 'Other', '===', '- [ ] y'];
        expect(endOf(lines, 'Top').at).toBe(3);
        expect(endOf(lines, 'Other').at).toBe(7);
    });

    it('keeps the note\'s final terminator after the section at the end of the note', () => {
        expect(endOf(['## J', '- [ ] j', ''], 'J').at).toBe(2);
    });

    it('spells the line as the item it goes below', () => {
        expect(endOf(['## K', '  - [ ] k', '', '## L'], 'K')).toEqual({ at: 2, parent: null, indent: '  ' });
    });
});

describe('Placement.into, at the head', () => {
    it('is just below the heading, at the top, unindented when no item follows', () => {
        expect(headOf(['## H', '- [ ] a'], 'H')).toEqual({ at: 1, parent: null, indent: '' });
        expect(headOf(['## H'], 'H')).toEqual({ at: 1, parent: null, indent: '' });
    });

    it('is at the indentation of the first item at the top below it, blank lines aside, as its sibling (P1)', () => {
        expect(headOf(['## H', '', '  - [ ] a', '\t- [ ] b'], 'H')).toEqual({ at: 1, parent: null, indent: '  ' });
    });

    it('is past the paragraph and the indented code below the heading, and not past the next heading', () => {
        expect(headOf(['## H', 'para', 'more', '', '- [ ] a'], 'H').at).toBe(3);
        // Four columns under a heading is indented code (measurement.md q10).
        expect(headOf(['## H', '\t- [ ] a', '\t\t- [ ] b', '- [ ] c'], 'H')).toEqual({ at: 3, parent: null, indent: '' });
        expect(headOf(['## H', '### Sub', 'para'], 'H').at).toBe(1);
        expect(headOf(['## H', '---', 'para'], 'H').at).toBe(1);
    });

    it('is below a setext heading\'s underline', () => {
        expect(headOf(['Tasks', '---', '- [ ] a'], 'Tasks').at).toBe(2);
    });
});
