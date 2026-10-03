import { describe, expect, it } from 'vitest';
import { Placement, type SectionSide, headingKey } from '../../../src/services/persistence/utils/Placement';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { NoteSections } from '../../../src/services/parsing/tree/NoteSections';

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

/**
 * A section reads its property lines only above its first task
 * (`NoteSections`), so a line put at its head goes past them: put above
 * them, it would cut them off, and every row of the section would lose
 * what they say. Where the block ends is the one `NoteSections` reads
 * (`PropertyBlock.end`); these check both that the spot is past it and
 * that the section reads the same properties with the line put there.
 */
describe('Placement.into, at the head of a section with property lines', () => {
    /** The section `name`'s own property entries, as `NoteSections` reads them. */
    const entriesOf = (lines: string[], name: string) => {
        const node = NoteSections.all(NoteSections.read(Outline.read(lines))).find(s => s.heading?.text === name);
        return node?.propertyBlock?.entries.map(e => [e.key, e.value]) ?? [];
    };
    /** The spot at the head of `name`, and the lines with `- [ ] m` put there, which read the section's properties as before. */
    const putAtHead = (lines: string[], name: string) => {
        const spot = headOf(lines, name);
        const put = [...lines.slice(0, spot.at), `${spot.indent}- [ ] m`, ...lines.slice(spot.at)];
        expect(entriesOf(put, name)).toEqual(entriesOf(lines, name));
        return { spot, put };
    };

    it('goes past a property line straight below the heading, and the section still reads it (the report)', () => {
        const { spot, put } = putAtHead(['### Section', '* tv-color:: #ffffff'], 'Section');
        expect(spot).toEqual({ at: 2, parent: null, indent: '' });
        expect(put).toEqual(['### Section', '* tv-color:: #ffffff', '- [ ] m']);
        expect(entriesOf(put, 'Section')).toEqual([['tv-color', '#ffffff']]);
    });

    it('goes past the block and above the tasks below it', () => {
        expect(putAtHead(['## S', '- tv-color:: red', '- tags:: a', '- [ ] a'], 'S').spot).toEqual({ at: 3, parent: null, indent: '' });
    });

    it('goes past the whole `- properties::` group, its entries with it', () => {
        expect(putAtHead(['## S', '- properties::', '  - tv-color:: red', '  - tags:: a', '- [ ] a'], 'S').spot.at).toBe(4);
    });

    it('goes past the group when a task in it ends the block, which reads as it did', () => {
        const lines = ['## S', '- properties::', '  - tv-color:: red', '  - [ ] t', '  - tags:: x', '- [ ] a'];
        expect(putAtHead(lines, 'S').spot.at).toBe(5);
        expect(entriesOf(lines, 'S')).toEqual([['tv-color', 'red']]);
    });

    it('goes past the subtree of the last property line, a task under it included', () => {
        expect(putAtHead(['## S', '- tv-color:: red', '    - [ ] c', '- [ ] a'], 'S').spot.at).toBe(3);
    });

    it('goes past text and blank lines between the heading and the block, and leaves the blank lines past the block below it', () => {
        expect(putAtHead(['## S', '', '- tv-color:: red', '', '- [ ] a'], 'S').spot.at).toBe(3);
        expect(putAtHead(['## S', 'para', '', '- tv-color:: red', '- tags:: a', '', '- [ ] a'], 'S').spot.at).toBe(5);
    });

    it('goes past the last property line where text stands between them', () => {
        expect(putAtHead(['## S', '- tv-color:: red', 'text', '- tags:: a', '- [ ] a'], 'S').spot.at).toBe(4);
    });

    it('takes the section\'s own block, not a nested heading\'s', () => {
        const lines = ['## S', '- tv-color:: red', '### Sub', '- tv-color:: blue', '- [ ] s'];
        expect(putAtHead(lines, 'S').spot.at).toBe(2);
        expect(putAtHead(lines, 'Sub').spot.at).toBe(4);
        expect(putAtHead(['## S', '### Sub', '- tv-color:: blue'], 'S').spot.at).toBe(1);
    });

    it('goes past the block of a section with nothing else in it', () => {
        expect(putAtHead(['## S', '- tv-color:: red', '', '## T'], 'S').spot.at).toBe(2);
    });

    it('does not count a property-like line in code, as the section does not', () => {
        expect(putAtHead(['## S', '```', '- tv-color:: red', '```', '- [ ] a'], 'S').spot.at).toBe(1);
        expect(putAtHead(['## S', '```', '- a:: 1', '```', '- tv-color:: red', '- [ ] a'], 'S').spot.at).toBe(5);
    });

    it('stays just below the heading when the property lines stand below the first task, which the section does not read', () => {
        expect(putAtHead(['## S', '- [ ] a', '- tv-color:: red'], 'S').spot.at).toBe(1);
    });

    it('leaves the end as it was: past the section\'s last line', () => {
        expect(endOf(['## S', '- tv-color:: red', '- [ ] a', '', '## T'], 'S').at).toBe(3);
        expect(endOf(['## S', '- tv-color:: red'], 'S').at).toBe(2);
    });
});
