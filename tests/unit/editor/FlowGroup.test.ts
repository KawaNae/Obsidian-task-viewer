import { describe, it, expect } from 'vitest';
import { flowOwnerOf } from '../../../src/editor/FlowGroup';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { isFlowLine, readFlow } from '../../../src/services/parsing/utils/FlowLineScanner';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types';

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

describe('the editor diagnostics read the flow lines the parser reads', () => {
    for (const [name, lines] of SHAPES) {
        it(name, () => {
            const outline = Outline.read(lines);
            const parsed = FileParsePipeline.parse('note.md', [...lines], DEFAULT_SETTINGS, namesOutsideIndex('note.md'));
            if (parsed.ignored) throw new Error('ignored');
            expect(parsed.tasks.length).toBeGreaterThan(0);

            for (const task of parsed.tasks) {
                expect(readFlow(outline, task.line), `flow of line ${task.line}`).toEqual(task.flow);
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
