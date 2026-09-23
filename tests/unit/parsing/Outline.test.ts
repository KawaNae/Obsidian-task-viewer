import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { DocumentTreeBuilder } from '../../../src/services/parsing/tree/DocumentTreeBuilder';
import type { SectionNode, TaskBlock } from '../../../src/services/parsing/tree/DocumentTree';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { DEFAULT_SETTINGS } from '../../../src/types';

describe('Outline.depthOf', () => {
    it('reads a tab as reaching the next multiple of four columns', () => {
        expect(Outline.depthOf('\t- x')).toBe(4);
        expect(Outline.depthOf('    - x')).toBe(4);
        expect(Outline.depthOf('  \t- x')).toBe(4);
        expect(Outline.depthOf('\t  - x')).toBe(6);
        expect(Outline.depthOf('\t\t- x')).toBe(Outline.depthOf('        - x'));
    });

    it('is zero for a line that is not indented', () => {
        expect(Outline.depthOf('- [ ] x')).toBe(0);
    });

    it('does not read a byte order mark as indentation', () => {
        expect(Outline.depthOf('\uFEFF- [ ] x')).toBe(0);
        expect(Outline.indentOf('\uFEFF- [ ] x')).toBe('');
    });

    it('reads only tabs and spaces as indentation, as Obsidian nests a list', () => {
        // A full-width or a no-break space does not nest a list item (R0).
        expect(Outline.indentOf(' \t\u00A0x')).toBe(' \t');
        expect(Outline.depthOf('\u3000\u3000- [ ] x')).toBe(0);
        expect(Outline.dedent(' \t\u00A0x')).toBe('\u00A0x');
    });
});

/** Every task block of the note, nested ones included. */
function blocksOf(lines: string[]): TaskBlock[] {
    const doc = DocumentTreeBuilder.build('note.md', lines, Outline.bodyStart(lines));
    const out: TaskBlock[] = [];
    const walkBlock = (block: TaskBlock) => {
        out.push(block);
        block.childTaskBlocks.forEach(walkBlock);
    };
    const walkSection = (section: SectionNode) => {
        for (const block of section.blocks) if (block.type === 'task-block') walkBlock(block);
        section.children.forEach(walkSection);
    };
    doc.sections.forEach(walkSection);
    return out;
}

/**
 * A note that mixes tabs and four-space indents writes one depth two ways.
 * `b` is `a`'s sibling at the width both show at; counting characters made
 * it `a`'s child (four spaces are more than one tab).
 */
const MIXED = [
    '- [ ] p',
    '\t- [ ] a',
    '    - [ ] b',
    '\t\t- [ ] c',
    '        - [ ] d',
    '- [ ] q',
    '',
];

describe('a note that mixes tabs and spaces', () => {
    it('is read with the parent and children it shows', () => {
        const parsed = FileParsePipeline.parse('note.md', [...MIXED], DEFAULT_SETTINGS);
        if (parsed.ignored) throw new Error('ignored');
        const byContent = new Map(parsed.tasks.map(task => [task.content, task]));
        const parentOf = (content: string) => {
            const parentId = byContent.get(content)!.parentId;
            return parsed.tasks.find(task => task.id === parentId)?.content;
        };
        expect(parentOf('a')).toBe('p');
        expect(parentOf('b')).toBe('p');
        expect(parentOf('c')).toBe('b');
        expect(parentOf('d')).toBe('b');
        expect(parentOf('q')).toBeUndefined();
    });

    it('has the subtree a write carries where the parser reads it', () => {
        const ops = new FileOperations({} as App);
        expect(ops.collectChildrenFromLines([...MIXED], 1).childrenLines).toEqual([]);
        expect(ops.collectChildrenFromLines([...MIXED], 2).childrenLines).toEqual([MIXED[3], MIXED[4]]);
    });
});

describe('Outline.subtreeEnd', () => {
    it('goes past a blank line to a deeper line, and stops before the blank lines after', () => {
        const lines = ['- [ ] a', '\t- b', '', '\t- c', '', '', '- [ ] d'];
        expect(Outline.subtreeEnd(lines, 0)).toBe(4);
    });

    it('is the line after the row when nothing below is deeper', () => {
        expect(Outline.subtreeEnd(['- [ ] a', '', '- [ ] b'], 0)).toBe(1);
    });

    it('takes a fence opened inside it whole, a closing line at column 0 included', () => {
        const lines = ['- [ ] T', '', '  ```js', 'code', '```', '- [ ] U'];
        expect(Outline.subtreeEnd(lines, 0)).toBe(5);
    });

    it('reads by depth alone when a fence opened inside it never closes', () => {
        // Taking the fence would take the rest of the note.
        const lines = ['- [ ] T', '', '  ```js', '  code', '- [ ] U', 'more'];
        expect(Outline.subtreeEnd(lines, 0)).toBe(4);
    });

    it('stops at the limit', () => {
        expect(Outline.subtreeEnd(['- [ ] a', '\t- b', '\t- c'], 0, 2)).toBe(2);
    });
});

describe('a child below a blank line', () => {
    it('is read as the child of the task above the blank line', () => {
        const lines = ['- [ ] p', '\t- [ ] a', '', '\t- [ ] b', '\t- key:: value', '', '- [ ] q', ''];
        const parsed = FileParsePipeline.parse('note.md', [...lines], DEFAULT_SETTINGS);
        if (parsed.ignored) throw new Error('ignored');
        const p = parsed.tasks.find(task => task.content === 'p')!;
        const b = parsed.tasks.find(task => task.content === 'b')!;
        expect(b.parentId).toBe(p.id);
        expect(parsed.tasks.find(task => task.content === 'q')!.parentId).toBeUndefined();
        // A property line below the blank line is the task's too.
        expect(p.properties.key?.value).toBe('value');
    });

    it('of a child task stays the child\'s, not the parent\'s child line', () => {
        const lines = ['- [ ] p', '\t- [ ] c', '', '\t\tmemo of c', '\tmemo of p', ''];
        const parsed = FileParsePipeline.parse('note.md', [...lines], DEFAULT_SETTINGS);
        if (parsed.ignored) throw new Error('ignored');
        const p = parsed.tasks.find(task => task.content === 'p')!;
        expect(p.childLines.map(line => line.text.trim())).toEqual(['memo of p']);
    });
});

/**
 * The lines a write takes for a task's subtree are the lines the parser reads
 * as its children, for every task of every shape here. A write that carried
 * or deleted lines the index does not read as children — or left behind
 * lines it does — is one the next scan reads differently from how it was
 * meant.
 */
describe('the write and the parser agree on every subtree', () => {
    const SHAPES: Array<[string, string[]]> = [
        ['tabs and spaces mixed', MIXED],
        ['spaces of two', ['- [ ] a', '  - [ ] b', '    - c', '  - d', '- [ ] e', '']],
        ['a fence in a child', ['- [ ] a', '\t```', '\t- [ ] x', '\t```', '\t- [ ] b', '- [ ] c', '']],
        ['a non-task parent', ['- note', '\t- [ ] a', '\t\t- [ ] b', '- [ ] c', '']],
        ['a blank line inside the children', ['- [ ] a', '\t- [ ] b', '', '\t- [ ] c', '\t\tmemo', '- [ ] d', '']],
        ['blank lines after the children', ['- [ ] a', '\t- [ ] b', '', '', '- [ ] c', '']],
        ['a blank line inside a grandchild', ['- [ ] a', '\t- [ ] b', '', '\t\t- [ ] c', '\t- [ ] d', '']],
        ['a child fence with a blank line', ['- [ ] a', '\t```', '\tx', '', '\ty', '\t```', '- [ ] b', '']],
        ['a blank line and then a shallower line', ['- [ ] a', '\t- [ ] b', '', 'text', '\t- [ ] c', '']],
        ['a heading after a blank line', ['- [ ] a', '\t- [ ] b', '', '# h', '\t- [ ] c', '']],
        ['a fence closed at column 0 below a blank line', ['- [ ] a', '\t- [ ] b', '', '  ```', 'x', '```', '- [ ] c', '']],
        // A `# comment` in a fence is code, not a section heading.
        ['a heading-like line in a fence under a task', ['- [ ] T', '  ```', '# x', '  ```', '\t- [ ] C', '- [ ] U', '']],
    ];

    for (const [name, lines] of SHAPES) {
        it(name, () => {
            const ops = new FileOperations({} as App);
            const blocks = blocksOf([...lines]);
            expect(blocks.length).toBeGreaterThan(0);
            for (const block of blocks) {
                const { childrenLines } = ops.collectChildrenFromLines([...lines], block.line);
                const written = childrenLines.map((_, i) => block.line + 1 + i);
                expect(written, `subtree of line ${block.line}`).toEqual(block.childLineNumbers);
            }
        });
    }
});
