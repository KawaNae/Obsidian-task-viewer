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

describe('OutlineReading.subtreeEnd', () => {
    const subtreeEnd = (lines: string[], row: number) => Outline.read(lines).subtreeEnd(row);

    it('goes past a blank line to a deeper line, and stops before the blank lines after', () => {
        const lines = ['- [ ] a', '\t- b', '', '\t- c', '', '', '- [ ] d'];
        expect(subtreeEnd(lines, 0)).toBe(4);
    });

    it('is the line after the row when nothing below is deeper', () => {
        expect(subtreeEnd(['- [ ] a', '', '- [ ] b'], 0)).toBe(1);
    });

    // (Obsidian, measurement.md q8) `code` at column 0 goes on the fence
    // opened in T, and T with it; the delimiter at column 0 opens a fence of
    // its own, which ends T and its fence.
    it('takes a shallow line in its fence, and ends at a delimiter at column 0 (Obsidian, measurement.md q8)', () => {
        const lines = ['- [ ] T', '', '  ```js', 'code', '```', '- [ ] U'];
        expect(subtreeEnd(lines, 0)).toBe(4);
    });

    it('ends a fence opened inside it that never closes with the item', () => {
        // Taking the fence would take the rest of the note.
        const lines = ['- [ ] T', '', '  ```js', '  code', '- [ ] U', 'more'];
        expect(subtreeEnd(lines, 0)).toBe(4);
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
        const lines = ['- [ ] p', '\t- [ ] c', '', '\t\tmemo of c', '', '\tmemo of p', ''];
        const parsed = FileParsePipeline.parse('note.md', [...lines], DEFAULT_SETTINGS);
        if (parsed.ignored) throw new Error('ignored');
        const p = parsed.tasks.find(task => task.content === 'p')!;
        // The blank line after c's subtree is not c's; it stands in p.
        expect(p.childLines.map(line => line.text.trim())).toEqual(['', 'memo of p']);
    });

    // (Obsidian, measurement.md q5) With no blank line between, `memo of p` goes on the
    // paragraph `memo of c` opened (a lazy continuation), so it is c's.
    it('takes a shallower line right below it as its paragraph going on (Obsidian, measurement.md q5)', () => {
        const lines = ['- [ ] p', '\t- [ ] c', '', '\t\tmemo of c', '\tmemo of p', ''];
        const parsed = FileParsePipeline.parse('note.md', [...lines], DEFAULT_SETTINGS);
        if (parsed.ignored) throw new Error('ignored');
        const p = parsed.tasks.find(task => task.content === 'p')!;
        const c = parsed.tasks.find(task => task.content === 'c')!;
        expect(p.childLines.map(line => line.text.trim())).toEqual([]);
        expect(c.childLines.map(line => line.text.trim())).toEqual(['', 'memo of c', 'memo of p']);
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
        // (Obsidian, measurement.md q11) `# x` at column 0 is a heading: it
        // ends T and its fence, and the delimiter after it opens a fence
        // that holds C and U.
        ['a heading-like line in a fence under a task', ['- [ ] T', '  ```', '# x', '  ```', '\t- [ ] C', '- [ ] U', '']],
        ['a tab-indented fence under a task', ['- [ ] T', '\t```js', '\t- [ ] x', '\t```', '\t- [ ] C', '- [ ] U', '']],
        // (Obsidian, measurement.md q8) six columns in is T's paragraph going
        // on, not a fence: `- [ ] x` is text too.
        ['a fence indented four columns past the content', ['- [ ] T', '      ```', '      - [ ] x', '      ```', '    - [ ] C', '- [ ] U', '']],
        // (Obsidian, measurement.md q2)
        ['a fence that never closes at the end of a subtree, and a sibling (R5)', ['- [ ] root', '    ```', '    body', '- [ ] sibling', '']],
        // (Obsidian, measurement.md q1)
        ['a fence that takes a line at column 0 (BK1)', ['- [ ] task', '    ```', 'shallow at column 0', '    ```', '- [ ] sibling', '']],
        // (Obsidian, measurement.md q5)
        ['a U+3000-led and an NBSP-led line between a parent and its tab child', ['- [ ] P', '　memo', '\t- [ ] c', '- [ ] Q', ' memo', '\t- [ ] d', '']],
        // (Obsidian, measurement.md q5, q9)
        ['`-[ ] x` between a parent and its tab child', ['- [ ] P', '-[ ] x', '\t- [ ] c', '- [ ] Q', '']],
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
