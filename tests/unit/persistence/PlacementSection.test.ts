import { describe, expect, it } from 'vitest';
import { Placement, headingKey } from '../../../src/services/persistence/utils/Placement';

/**
 * A move's destination in its own note (F8): the heading a `[[#name]]` names,
 * looked up as Obsidian resolves the link, and the end of its section.
 */
const endOf = (lines: string[], name: string, head = '- [ ] m') => {
    const found = Placement.heading(lines, name);
    if (found.kind !== 'one') throw new Error(`no one heading: ${found.kind}`);
    return Placement.sectionEnd(lines, found.heading, head);
};

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
        expect(Placement.heading(lines, 'done now')).toEqual({ kind: 'one', heading: expect.objectContaining({ line: 1, level: 2 }) });
        expect(Placement.heading(lines, ' DONE  now ')).toMatchObject({ kind: 'one' });
    });

    it('answers none when no heading has the name, a heading-like line in a fence or an item aside', () => {
        const lines = ['```', '## Done', '```', '- [ ] a', '  ## Done'];
        expect(Placement.heading(lines, 'Done')).toEqual({ kind: 'none' });
    });

    it('answers how many when two or more headings have the name, whatever their levels and case', () => {
        const lines = ['## Case', '- [ ] a', '### case', 'Case', '---'];
        expect(Placement.heading(lines, 'CASE')).toEqual({ kind: 'many', count: 3 });
    });
});

describe('Placement.sectionEnd', () => {
    it('is past the last line of the section, which runs to the next heading of its level or above', () => {
        const lines = ['# A', '- [ ] a1', '## B', '- [ ] b1', '# C', '- [ ] c1'];
        expect(endOf(lines, 'A')).toEqual({ at: 4, parent: null, indent: '' });
        expect(endOf(lines, 'B')).toEqual({ at: 4, parent: null, indent: '' });
        expect(endOf(lines, 'C')).toEqual({ at: 6, parent: null, indent: '' });
    });

    it('stops at a heading of its own level, not at a deeper one', () => {
        const lines = ['## A', '- [ ] a1', '### Sub', '- [ ] s1', '## B', '- [ ] b1'];
        expect(endOf(lines, 'A').at).toBe(4);
        expect(endOf(lines, 'Sub').at).toBe(4);
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
