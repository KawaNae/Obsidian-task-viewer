import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { renderFlowInstance } from '../../../src/services/persistence/FlowInstanceLines';

/**
 * The indentation of a child is decided in one place (`Outline.childIndent`),
 * and a line a move carries keeps its columns past its task
 * (`Outline.shiftIndent`). Every written child is checked here by reading it
 * back: the line has to open an item whose parent is the line it was meant for.
 */

/**
 * The parent the outline reads for the item on `line` of `lines`, read
 * under a top-level item `- r` so that a line indented two columns or more
 * stands in a list, as it would in a note, not in indented code. Answers in
 * the coordinates of `lines`, `-1` for the root.
 */
function parentOf(lines: string[], line: number): number | null | undefined {
    const rooted = Outline.depthOf(lines[0]) >= 2;
    const parent = Outline.read(rooted ? ['- r', ...lines] : lines).item(rooted ? line + 1 : line)?.parent;
    return rooted && typeof parent === 'number' ? parent - 1 : parent;
}

describe('Outline.childIndent', () => {
    it('takes the sample where it lands as a child', () => {
        expect(Outline.childIndent('- [ ] a', '\t', '    ')).toBe('\t');
        expect(Outline.childIndent('- [ ] a', '  ', '\t')).toBe('  ');
        expect(Outline.childIndent('- [ ] a', '     ', '\t')).toBe('     ');
    });

    it('does not take a sample short of the content column, or four past it', () => {
        // `100. [ ] a` opens its content at column 5: a tab (4) is short of it.
        expect(Outline.childIndent('100. [ ] a', '\t', '\t')).toBe('\t\t');
        // Six spaces under `- [ ] a` (content at 2) are indented code.
        expect(Outline.childIndent('- [ ] a', '      ', '\t')).toBe('\t');
    });

    it('repeats the unit from the parent\'s own indentation until it reaches the content column', () => {
        expect(Outline.childIndent('\t- [ ] a', null, '\t')).toBe('\t\t');
        expect(Outline.childIndent('    - [ ] a', null, '    ')).toBe('        ');
        expect(Outline.childIndent('10.   [ ] a', null, '\t')).toBe('\t\t');
    });

    it('uses a tab sample under a space-indented parent when it lands as a child', () => {
        expect(Outline.childIndent('    - [ ] a', '\t\t', '    ')).toBe('\t\t');
    });

    it('puts the child under its parent, whatever the parent and the unit', () => {
        const parents = ['- [ ] a', '\t- [ ] a', '    - [ ] a', '  - [ ] a', '100. [ ] a', '10.   [ ] a', '\t1. [ ] a', '  \t- [ ] a'];
        const samples = [null, '\t', '  ', '    ', '\t\t', '      ', '        '];
        for (const parent of parents) {
            for (const sample of samples) {
                for (const unit of ['\t', '    ', '  ']) {
                    const child = Outline.childIndent(parent, sample, unit) + '- [ ] c';
                    expect(parentOf([parent, child], 1), JSON.stringify([parent, sample, unit])).toBe(0);
                }
            }
        }
    });
});

describe('Outline.shiftIndent', () => {
    it('takes the parent\'s characters off when that keeps the columns', () => {
        expect(Outline.shiftIndent('\t\t- [ ] c', '\t', '')).toBe('\t- [ ] c');
        expect(Outline.shiftIndent('        - c', '    ', '')).toBe('    - c');
        expect(Outline.shiftIndent('\t- c', '', '\t')).toBe('\t\t- c');
    });

    it('writes the columns in spaces when the characters cut off would not keep them (G3)', () => {
        // Under a tab (column 4), eight spaces are four past it.
        expect(Outline.shiftIndent('        - [ ] c', '\t', '')).toBe('    - [ ] c');
        // Under four spaces, a tab and two spaces are at column 6: two past it.
        expect(Outline.shiftIndent('\t  - [ ] c', '    ', '')).toBe('  - [ ] c');
        // Two spaces and a tab reach column 4; with the two spaces cut off, the tab alone would too.
        expect(Outline.shiftIndent('  \t- c', '  ', '')).toBe('  - c');
    });

    it('leaves a blank line as it is, and writes a line shallower than its parent at the new parent', () => {
        expect(Outline.shiftIndent('  ', '\t', '')).toBe('  ');
        expect(Outline.shiftIndent('lazy', '\t', '')).toBe('lazy');
        expect(Outline.shiftIndent('  lazy', '\t', '  ')).toBe('  lazy');
    });

    it('leaves a line carried to where it stands as it is written, a lazy one included', () => {
        expect(Outline.shiftIndent('lazy', '\t', '\t')).toBe('lazy');
        expect(Outline.shiftIndent('  \t- c', '  ', '  ')).toBe('  \t- c');
    });

    it('keeps a child a child, whatever the old and new parents are indented with', () => {
        // At most five columns, where a line under the root `- r` opens an item.
        const indents = ['', '\t', '    ', '  ', '  \t', '\t '];
        for (const from of indents) {
            for (const to of indents) {
                for (const past of ['\t', '  ', '    ', ' \t']) {
                    const parent = from + '- [ ] p';
                    const child = from + past + '- [ ] c';
                    if (parentOf([parent, child], 1) !== 0) continue;
                    const moved = [to + '- [ ] p', Outline.shiftIndent(child, from, to)];
                    expect(parentOf(moved, 1), JSON.stringify([from, to, past])).toBe(0);
                }
            }
        }
    });
});

describe('renderFlowInstance: the lines a next instance is written as', () => {
    const fileOps = new FileOperations({} as App);

    it('indents the `==>` line for the line written, not the one that fired (H2)', () => {
        // `10.   [ ] T` opens its content at column 6, and its `==>` line at
        // six spaces is its child. The next instance is written `- [ ] T`
        // (content at 2): six spaces under it are indented code.
        const lines = ['10.   [ ] T ==> next', '      - ==> every day', ''];
        const rendered = texts(renderFlowInstance(fileOps, lines, 0, { kind: 'recurrence', content: '- [ ] T', flowLines: ['every day'] }, spotOf(lines, 0)));
        // The file's unit is four spaces (its first indented line).
        expect(rendered).toEqual(['- [ ] T', '    - ==> every day']);
        expect(parentOf(rendered, 1)).toBe(0);
    });

    it('writes the same bytes as the row\'s children where they fit the line written', () => {
        const lines = ['- [ ] T', '  - ==> every day', ''];
        const rendered = texts(renderFlowInstance(fileOps, lines, 0, { kind: 'recurrence', content: '- [ ] T', flowLines: ['every day'] }, spotOf(lines, 0)));
        expect(rendered).toEqual(['- [ ] T', '  - ==> every day']);
    });

    it('puts each generated child under the line one depth up, tab and spaces mixed', () => {
        // T is a tab in (column 4, content at 6), its first child eight
        // spaces: cut by T's one character, the step was seven spaces, and
        // the children landed five past G's content, a paragraph line.
        const lines = ['- r', '\t- [ ] T', '        - note', ''];
        const rendered = texts(renderFlowInstance(fileOps, lines, 1, {
            kind: 'generated',
            parentLine: '- [ ] G',
            flowLines: ['every day'],
            children: [{ depth: 1, body: '- [ ] c1' }, { depth: 2, body: '- [ ] c2' }, { depth: 1, body: '- [ ] c3' }],
        }, spotOf(lines, 1)));
        expect(rendered[0]).toBe('\t- [ ] G');
        expect([1, 2, 3, 4].map(line => parentOf(rendered, line))).toEqual([0, 0, 2, 0]);
    });

    it('keeps the step of the task\'s own children where it is not the file\'s unit', () => {
        // Children two spaces in; the file's unit reads four (the mutation run's 8f).
        const lines = ['- [ ] T', '  - note', ''];
        const rendered = renderFlowInstance(fileOps, lines, 0, {
            kind: 'generated',
            parentLine: '- [ ] G',
            flowLines: ['every day'],
            children: [{ depth: 1, body: '- [ ] c1' }, { depth: 2, body: '- [ ] c2' }],
        }, spotOf(lines, 0));
        expect(texts(rendered)).toEqual(['- [ ] G', '  - ==> every day', '  - [ ] c1', '    - [ ] c2']);
    });

    it('writes the same bytes as before where the first child is a unit past the task', () => {
        const lines = ['- r', '\t- [ ] T', '\t\t- note', ''];
        const rendered = renderFlowInstance(fileOps, lines, 1, {
            kind: 'generated',
            parentLine: '- [ ] G',
            flowLines: ['every day'],
            children: [{ depth: 1, body: '- [ ] c1' }, { depth: 2, body: '- [ ] c2' }, { depth: 1, body: 'text' }],
        }, spotOf(lines, 1));
        expect(texts(rendered)).toEqual(['\t- [ ] G', '\t\t- ==> every day', '\t\t- [ ] c1', '\t\t\t- [ ] c2', '\t\ttext']);
        // Each says how it is to read: the head under the spot's parent, the
        // command and the first child under the head, the second under the
        // first, a line of text as text.
        expect(rendered.map(line => [line.kind, line.under])).toEqual([
            ['item', 'spot'], ['item', 0], ['item', 0], ['item', 2], ['text', undefined],
        ]);
    });
});

/** The spot the next instance of `row` goes to: its own indentation, as the row is its group's head here. */
function spotOf(lines: string[], row: number) {
    return { at: row, parent: null, indent: Outline.indentOf(lines[row]) };
}

function texts(lines: readonly { text: string }[]): string[] {
    return lines.map(line => line.text);
}
