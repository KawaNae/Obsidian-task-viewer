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

    it('counts spaces and tabs only', () => {
        expect(Outline.depthOf('\uFEFF- [ ] x')).toBe(0);
        expect(Outline.indentOf('\uFEFF- [ ] x')).toBe('');
        expect(Outline.indentOf(' \t\u00A0x')).toBe(' \t');
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
        const parsed = FileParsePipeline.parse('note.md', [...MIXED], undefined, DEFAULT_SETTINGS);
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
