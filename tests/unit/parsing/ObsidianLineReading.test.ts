import { describe, it, expect } from 'vitest';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { TaskLineClassifier } from '../../../src/services/parsing/utils/TaskLineClassifier';
import { ChildLineClassifier } from '../../../src/services/parsing/utils/ChildLineClassifier';
import { matchFlowLine } from '../../../src/services/parsing/utils/FlowLineScanner';
import { readsAsPlanned } from '../../../src/services/persistence/RowBasis';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { leadingIndent } from '../../../src/services/parsing/gen/GenBodyParser';
import { HEADING_REGEX } from '../../../src/services/parsing/tree/DocumentTreeBuilder';
import { splitLines } from '../../../src/utils/FileLines';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * What a line is and how deep it stands, read as Obsidian 1.12.4 reads it
 * (R0, `.plan/stages/r0-observe/report.md`, question 1). The cases are the
 * R0 probe's, byte for byte; the expectations are Obsidian's metadata
 * (`listItems`) rather than the plugin's reading at the time.
 */

// Built from code points: a raw U+2028 is a syntax error in a regex literal,
// and an editor may turn the escape into the character.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const IDEOGRAPHIC = String.fromCharCode(0x3000);
const NBSP = String.fromCharCode(0x00a0);
const BOM = String.fromCharCode(0xfeff);

function parse(content: string) {
    const parsed = FileParsePipeline.parse('note.md', splitLines(content).lines, DEFAULT_SETTINGS);
    if (parsed.ignored) throw new Error('ignored');
    const tasks = parsed.tasks;
    const parentOf = (content: string) => {
        const parentId = tasks.find(task => task.content === content)!.parentId;
        return tasks.find(task => task.id === parentId)?.content;
    };
    return { tasks, contents: tasks.map(task => task.content), parentOf };
}

describe('indentation, as Obsidian nests a list', () => {
    it('reads a line opened with a full-width or a no-break space as no task, and no child', () => {
        // Obsidian's metadata has one list item here: the second line is the
        // first item going on, not a nested one.
        for (const [name, lead] of [['U+3000', IDEOGRAPHIC], ['NBSP', NBSP]] as const) {
            const read = parse(`- [ ] parent\n${lead}- [ ] indented by ${name}\n`);
            expect(read.contents, name).toEqual(['parent']);
        }
    });

    it('still nests a line indented with a tab or with spaces', () => {
        for (const lead of ['\t', '  ']) {
            const read = parse(`- [ ] parent\n${lead}- [ ] child\n`);
            expect(read.contents).toEqual(['parent', 'child']);
            expect(read.parentOf('child')).toBe('parent');
        }
    });

    it('is the same set of characters to every reader of a line\'s indentation', () => {
        // Each of these answers "how is this line indented" on its own terms;
        // they agree with Outline on every lead, or the index and the writes
        // read one note two ways.
        const leads = ['', ' ', '  ', '\t', ' \t', IDEOGRAPHIC, NBSP, LS, PS, BOM, `\t${IDEOGRAPHIC}`, ` ${NBSP}`];
        for (const lead of leads) {
            const indent = Outline.indentOf(`${lead}- [ ] x`);
            expect(/^[ \t]*$/.test(indent), JSON.stringify(lead)).toBe(true);
            const nests = indent === lead;
            const label = JSON.stringify(lead);

            expect(TaskLineClassifier.isTaskLine(`${lead}- [ ] x`), label).toBe(nests);
            expect(TaskLineClassifier.classify(`${lead}- [ ] x`)?.indent ?? indent, label).toBe(indent);
            expect(ChildLineClassifier.classify(`${lead}- [ ] x`, 0).indent, label).toBe(indent);
            expect(ChildLineClassifier.classify(`${lead}- k:: v`, 0).propertyKey !== null, label).toBe(nests);
            expect(ChildLineClassifier.classify(`${lead}- [[note]]`, 0).wikilinkTarget !== null, label).toBe(nests);
            expect(ChildLineClassifier.isPropertyLine(`${lead}- k:: v`), label).toBe(nests);
            expect(matchFlowLine(`${lead}- ==> next`) !== null, label).toBe(nests);
            expect(leadingIndent(`${lead}text`), label).toBe(Outline.indentOf(`${lead}text`));
            expect(Outline.dedent(`${lead}- [ ] x`), label).toBe(`${lead}- [ ] x`.slice(indent.length));
        }
    });

    it('takes an indent unit only from a tab or a space', () => {
        expect(FileOperations.detectIndentUnit(['- a', `${IDEOGRAPHIC}- b`, '  - c'])).toBe('    ');
        expect(FileOperations.detectIndentUnit(['- a', `${NBSP}- b`])).toBe('\t');
        expect(FileOperations.detectIndentUnit(['- a', '\t- b'])).toBe('\t');
    });

    it('takes only the row as written, indentation included, for the row a basis was read from', () => {
        // The basis compares a row verbatim. A full-width space is not
        // indentation, and a tab moves the row to another depth: either way
        // that line is another line, not the row the plan read.
        const basis = { text: '\t- [ ] a' };
        expect(readsAsPlanned([`${IDEOGRAPHIC}- [ ] a`], 0, basis)).toBe(false);
        expect(readsAsPlanned([`${NBSP}- [ ] a`], 0, basis)).toBe(false);
        expect(readsAsPlanned(['- [ ] a'], 0, basis)).toBe(false);
        expect(readsAsPlanned(['\t- [ ] a'], 0, basis)).toBe(true);
    });
});

describe('line breaks, as Obsidian ends a line', () => {
    it('reads a checkbox line holding U+2028 or U+2029 as one task', () => {
        for (const sep of [LS, PS]) {
            const read = parse(`- [ ] before${sep}after\n`);
            expect(read.contents).toEqual([`before${sep}after`]);
        }
    });

    it('takes any status but U+2028 and U+2029, which are no task to Obsidian', () => {
        // Dev, Obsidian 1.12.4: `listItems`, Live Preview and the reading view
        // agree (`.plan/stages/l1-lines/device-1.md`).
        for (const sep of [LS, PS]) {
            expect(TaskLineClassifier.isTaskLine(`- [${sep}] a`)).toBe(false);
            expect(TaskLineClassifier.isTaskLine(`\t- [${sep}] a`)).toBe(false);
            expect(parse(`- [ ] p\n\t- [${sep}] c\n`).contents).toEqual(['p']);
        }
        for (const status of ['\t', NBSP, IDEOGRAPHIC, BOM, String.fromCharCode(0x200b)]) {
            expect(TaskLineClassifier.classify(`- [${status}] a`)?.statusChar).toBe(status);
            expect(TaskLineClassifier.classify(`\t- [${status}] a`)?.statusChar).toBe(status);
        }
    });

    it('reads a checkbox as a task only with a space or a tab after `]`', () => {
        // Dev, Obsidian 1.12.4: `listItems` and the reading view agree
        // (`.plan/stages/l1-lines/device-1.md`).
        for (const tail of [' x', '\tx', ' ']) {
            expect(TaskLineClassifier.isTaskLine(`- [ ]${tail}`)).toBe(true);
            expect(TaskLineClassifier.isTaskLine(`\t- [ ]${tail}`)).toBe(true);
        }
        for (const tail of ['x', '', `${NBSP}x`, `${IDEOGRAPHIC}x`, `${LS}x`, `${PS}x`]) {
            expect(TaskLineClassifier.isTaskLine(`- [ ]${tail}`)).toBe(false);
            expect(TaskLineClassifier.isTaskLine(`\t- [ ]${tail}`)).toBe(false);
            expect(parse(`- [ ] p\n\t- [ ]${tail}\n`).contents).toEqual(['p']);
        }
        expect(TaskLineClassifier.classify('- [ ]\tx')?.rawContent).toBe('x');
        expect(TaskLineClassifier.classify('- [ ] ')?.rawContent).toBe('');
    });

    it('reads a checkbox as a task only after one to four spaces or one tab past the marker', () => {
        // Dev, Obsidian 1.12.4: `listItems` and the reading view agree, for
        // every marker, at the top level and nested (verify-scripts
        // `l1-marker-gap.js`). Live Preview draws a checkbox after anything.
        for (const marker of ['-', '*', '+', '1.', '1)']) {
            for (const gap of [' ', '  ', '   ', '    ', '\t']) {
                expect(TaskLineClassifier.isTaskLine(`${marker}${gap}[ ] x`), `${marker}${JSON.stringify(gap)}`).toBe(true);
                expect(TaskLineClassifier.isTaskLine(`\t${marker}${gap}[ ] x`)).toBe(true);
            }
            for (const gap of ['', '     ', ' \t', '\t\t', NBSP, IDEOGRAPHIC]) {
                expect(TaskLineClassifier.isTaskLine(`${marker}${gap}[ ] x`), `${marker}${JSON.stringify(gap)}`).toBe(false);
                expect(TaskLineClassifier.isTaskLine(`\t${marker}${gap}[ ] x`)).toBe(false);
            }
        }
        expect(parse('- [ ] p\n\t-\t[ ] c\n').contents).toEqual(['p', 'c']);
        expect(parse('- [ ] p\n\t-     [ ] c\n').contents).toEqual(['p']);
        expect(parse('-[ ] p\n').contents).toEqual([]);
        // A checkbox among a row's children is the same reading: not a property
        expect(ChildLineClassifier.classify('\t-\t[ ] k:: v', 0).propertyKey).toBeNull();
    });

    it('reads a task with no content and a block id as a task', () => {
        const read = parse('- [ ] ^abc\n');
        expect(read.tasks.map(task => [task.content, task.blockId])).toEqual([['', 'abc']]);
    });

    it('reads a CR on its own as the end of the line', () => {
        // Obsidian draws two lines and reads the first as the checkbox.
        const read = parse('- [ ] before\rafter\n');
        expect(read.contents).toEqual(['before']);
    });

    it('reads the rest of the line past U+2028 in every line pattern', () => {
        const classified = TaskLineClassifier.classify(`- [ ] a${LS}b`);
        expect(classified?.rawContent).toBe(`a${LS}b`);
        expect(TaskLineClassifier.classify(`- [x] a${PS}b ^abc`)?.rawContent).toBe(`a${PS}b ^abc`);

        const property = ChildLineClassifier.classify(`    - k:: a${LS}b`, 0);
        expect([property.propertyKey, property.propertyValue]).toEqual(['k', `a${LS}b`]);
        expect(ChildLineClassifier.inferType(`[a${LS}b]`)).toBe('array');

        expect(matchFlowLine(`    - ==> next${LS}more`)?.tail).toBe(`next${LS}more`);
        expect(HEADING_REGEX.exec(`## a${LS}b`)?.[2]).toBe(`a${LS}b`);
    });

    it('keeps the whole command past U+2028 on a task line', () => {
        // With `.` the command stopped at the separator and the rest was dropped.
        const read = parse(`- [ ] a ==> next${LS}set content = "x"\n`);
        expect(read.tasks[0].content).toBe('a');
        expect(read.tasks[0].flow?.raw).toContain(`next${LS}set content = "x"`);
    });
});
