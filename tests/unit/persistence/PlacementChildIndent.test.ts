import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { Placement } from '../../../src/services/persistence/utils/Placement';

describe('Placement', () => {

    // A child's indentation (`Outline.childIndent`) and the columns a carried
    // line keeps (`Outline.shiftIndent`) are the outline's: `OutlineIndent.test.ts`.


    describe('resolveChildIndent', () => {
        const resolve = (lines: string[], line: number, parent?: string, except?: ReadonlySet<number>, unit = '\t') =>
            Placement.resolveChildIndent(Outline.read(lines), line, unit, parent, except);

        it('copies the first existing child', () => {
            const lines = ['- [ ] parent', '\t- [ ] child'];
            expect(resolve(lines,0)).toBe('\t');
        });

        it('prefers the task\'s own children over the rest of the file', () => {
            const lines = ['- [ ] other', '    - [ ] other child', '- [ ] parent', '\t- [ ] child'];
            expect(resolve(lines,2)).toBe('\t');
        });

        it('takes the new level Obsidian\'s settings say when the task has no children, whatever the rest of the file does', () => {
            // A line one level deeper than any beside it is spelled as the
            // editor spells a new level, not copied from another task's children.
            const lines = ['- [ ] parent', '- [ ] other', '    - [ ] other child'];
            expect(resolve(lines,0)).toBe('\t');
            expect(resolve(lines,0, undefined, undefined, '  ')).toBe('  ');
            expect(resolve(['- [ ] other', '\t- [ ] other child', '- [ ] parent'],2, undefined, undefined, '    ')).toBe('    ');
        });

        it('builds the new level on the parent\'s own indentation, repeated to its content column', () => {
            expect(resolve(['\t- [ ] parent'],0, undefined, undefined, '    ')).toBe('\t    ');
            // `10. ` opens its content at column 4: two spaces are one short.
            expect(resolve(['10. [ ] parent'],0, undefined, undefined, '  ')).toBe('    ');
        });

        it('copies an existing child over the settings', () => {
            expect(resolve(['- [ ] parent', '  - [ ] child'],0, undefined, undefined, '\t')).toBe('  ');
        });

        it('nests below an already indented parent', () => {
            const lines = ['- [ ] top', '\t- [ ] parent', '\t\t- [ ] child'];
            expect(resolve(lines,1)).toBe('\t\t');
        });

        it('carries the first child under a line written in the task\'s place, as far past it as it stands past the task', () => {
            // The next instance of a tab row, written at four spaces: its
            // child is a tab past the four spaces, as the tab row's is past the tab.
            const lines = ['- [ ] P', '\t- [ ] T', '\t\t- [ ] c'];
            expect(resolve(lines,1, '    - [ ] T')).toBe('    \t');
        });

        it('takes the sample from the children the write keeps, and from the others where it keeps none', () => {
            const lines = ['- [ ] T', '\t- ==> every mon', '  - [ ] c'];
            expect(resolve(lines,0, lines[0], new Set([1]))).toBe('  ');
            expect(resolve(['- [ ] T', '\t- ==> every mon'],0, '- [ ] T', new Set([1]))).toBe('\t');
        });

        it('copies a child past a blank line, which does not end the item', () => {
            const lines = ['- [ ] parent', '', '    - [ ] child'];
            expect(resolve(lines,0)).toBe('    ');
        });
    });
});
