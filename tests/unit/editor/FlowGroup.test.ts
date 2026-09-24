import { describe, it, expect } from 'vitest';
import { flowGroupOf, flowOwnerOf } from '../../../src/editor/FlowGroup';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { isFlowLine } from '../../../src/services/parsing/utils/FlowLineScanner';
import { DocumentTreeBuilder } from '../../../src/services/parsing/tree/DocumentTreeBuilder';
import type { SectionNode, TaskBlock } from '../../../src/services/parsing/tree/DocumentTree';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { DEFAULT_SETTINGS } from '../../../src/types';

/** Every task block of the note, nested ones included. */
function blocksOf(lines: string[]): TaskBlock[] {
    const doc = DocumentTreeBuilder.build('note.md', lines, Outline.bodyStart(lines));
    const out: TaskBlock[] = [];
    const walkBlock = (block: TaskBlock) => {
        out.push(block);
        block.childTaskBlocks.forEach(walkBlock);
    };
    const walkSection = (section: SectionNode) => {
        section.blocks.forEach(walkBlock);
        section.children.forEach(walkSection);
    };
    doc.sections.forEach(walkSection);
    return out;
}

const D = '@2026-09-24';
const SHAPES: Array<[string, string[]]> = [
    ['direct, nested and after a blank line', [
        `- [ ] a ${D} ==> every mon`, '\t- ==> x3', `\t- [ ] b ${D} ==> every tue`, '\t\t- ==> x2',
        '\t- note', '\t\t- ==> not a\'s', '', '\t- ==> after blank', `- [ ] c ${D}`, '',
    ]],
    ['a flow line more than a hundred lines below its task', [
        `- [ ] a ${D} ==> every mon`, ...Array.from({ length: 150 }, (_, i) => `\t- memo ${i}`), '\t- ==> x3', '',
    ]],
    ['a flow line in a fence under the task', [
        `- [ ] a ${D} ==> every mon`, '\t```', '\t- ==> in the fence', '\t```', '\t- ==> x3', '',
    ]],
    // (Obsidian, measurement.md q1) the shallow line goes on the fence, and
    // the task with it, to the closing line.
    ['a fence that takes a shallower line (BK1)', [
        `- [ ] a ${D} ==> every mon`, '    ```', 'shallow at column 0', '    ```', '    - ==> x3', `- [ ] b ${D}`, '',
    ]],
    // (Obsidian, measurement.md q6) one column in after a blank line is an
    // item at the top, not the task's.
    ['a flow line one column in after a blank line', [
        `- [ ] a ${D} ==> every mon`, '', ' - ==> x3', '',
    ]],
    // (Obsidian, measurement.md q5) a line at column 0 goes on the task's
    // paragraph, and the tab child below it is the task's.
    ['a paragraph line going on at column 0', [
        `- [ ] a ${D} ==> every mon`, 'memo at column 0', '\t- ==> x3', '',
    ]],
];

describe('the editor diagnostics read the subtree and the flow lines the parser reads', () => {
    for (const [name, lines] of SHAPES) {
        it(name, () => {
            const outline = Outline.read(lines);
            const parsed = FileParsePipeline.parse('note.md', [...lines], DEFAULT_SETTINGS);
            if (parsed.ignored) throw new Error('ignored');
            const blocks = blocksOf([...lines]);
            expect(blocks.length).toBeGreaterThan(0);

            for (const block of blocks) {
                const group = flowGroupOf(outline, block.line);
                expect(group.childLines, `children of line ${block.line}`).toEqual(block.childRawLines);

                const task = parsed.tasks.find(candidate => candidate.line === block.line)!;
                const parserFlow = (task.flow?.childSegments ?? []).map(segment => segment.bodyLine);
                expect(group.flowLines, `flow lines of line ${block.line}`).toEqual(parserFlow);
            }

            // Every flow line the editor gives an owner is one that owner's
            // flow holds, and every one the parser merged has that owner.
            const owners = new Map<number, number>();
            for (const task of parsed.tasks) {
                for (const segment of task.flow?.childSegments ?? []) owners.set(segment.bodyLine, task.line);
            }
            lines.forEach((text, line) => {
                if (!isFlowLine(text)) return;
                expect(flowOwnerOf(outline, line), `owner of line ${line}`).toBe(owners.get(line) ?? null);
            });
        });
    }
});
