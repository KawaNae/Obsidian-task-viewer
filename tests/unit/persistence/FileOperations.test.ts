import { describe, it, expect } from 'vitest';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import type { App } from 'obsidian';

// Instance with dummy App (methods under test don't use vault)
const ops = new FileOperations({} as App);

describe('FileOperations', () => {

    // A child's indentation (`Outline.childIndent`) and the columns a carried
    // line keeps (`Outline.shiftIndent`) are the outline's: `OutlineIndent.test.ts`.

    // ── collectChildrenFromLines ──
    describe('collectChildrenFromLines', () => {
        it('collects indented children', () => {
            const lines = [
                '- [ ] parent',
                '    - [ ] child 1',
                '    - [ ] child 2',
                '- [ ] sibling',
            ];
            const result = ops.collectChildrenFromLines(Outline.read(lines), 0);
            expect(result.childrenLines).toEqual(['    - [ ] child 1', '    - [ ] child 2']);
        });

        // Characterization: a blank line terminates the subtree even when
        // deeper-indented lines follow. Pinned deliberately — the session-record
        // work may revisit it, so any change must be a conscious one.
        it('reads past a blank line inside the children, and leaves the ones after them', () => {
            const lines = [
                '- [ ] parent',
                '    - [ ] child',
                '',
                '    - [ ] also a child',
                '',
                '- [ ] sibling',
            ];
            const result = ops.collectChildrenFromLines(Outline.read(lines), 0);
            expect(result.childrenLines).toEqual(['    - [ ] child', '', '    - [ ] also a child']);
        });

        // Characterization: this is a *range* function — every consumer uses the
        // result as a splice extent or an indent baseline, never as task lines.
        // Fenced content must therefore travel with the subtree verbatim;
        // excluding it would make the splice range cut through the fence.
        it('collects fenced lines verbatim, including checkbox-looking ones', () => {
            const lines = [
                '- [ ] parent',
                '    ```md',
                '    - [ ] not a real task',
                '    ```',
                '    - [ ] real child',
                '- [ ] sibling',
            ];
            const result = ops.collectChildrenFromLines(Outline.read(lines), 0);
            expect(result.childrenLines).toEqual([
                '    ```md',
                '    - [ ] not a real task',
                '    ```',
                '    - [ ] real child',
            ]);
        });

        it('stops at same-level line', () => {
            const lines = [
                '- [ ] parent',
                '    child',
                '- [ ] next',
            ];
            const result = ops.collectChildrenFromLines(Outline.read(lines), 0);
            expect(result.childrenLines).toEqual(['    child']);
        });

        it('returns empty when no children', () => {
            const lines = ['- [ ] alone', '- [ ] next'];
            const result = ops.collectChildrenFromLines(Outline.read(lines), 0);
            expect(result.childrenLines).toEqual([]);
        });

        it('handles tab-indented children', () => {
            const lines = [
                '- [ ] parent',
                '\t- [ ] child',
                '\t\t- [ ] grandchild',
                '- [ ] next',
            ];
            const result = ops.collectChildrenFromLines(Outline.read(lines), 0);
            expect(result.childrenLines).toHaveLength(2);
        });

        it('collects deeply nested children', () => {
            // Under a root: a tab at the top of a note is indented code
            // (Obsidian, measurement.md q10), and opens no item.
            const lines = [
                '- [ ] root',
                '\t- [ ] parent',
                '\t\t- [ ] child',
                '\t\t\t- [ ] grandchild',
                '\t- [ ] sibling',
            ];
            const result = ops.collectChildrenFromLines(Outline.read(lines), 1);
            expect(result.childrenLines).toHaveLength(2);
            // Width, not characters: one tab is four columns.
        });
    });

    // ── stripBlockIds ──
    describe('stripBlockIds', () => {
        it('removes block IDs', () => {
            const result = ops.stripBlockIds(['- [ ] task ^abc123']);
            expect(result).toEqual(['- [ ] task']);
        });

        it('preserves lines without block IDs', () => {
            const result = ops.stripBlockIds(['- [ ] task', 'plain text']);
            expect(result).toEqual(['- [ ] task', 'plain text']);
        });

        it('handles multiple lines', () => {
            const result = ops.stripBlockIds([
                '- [ ] first ^id1',
                '    child',
                '- [ ] second ^id2',
            ]);
            expect(result).toEqual(['- [ ] first', '    child', '- [ ] second']);
        });

        it('does not remove caret that is not a valid block ID', () => {
            const result = ops.stripBlockIds(['text with ^caret mid-line']);
            // "^caret mid-line" contains spaces — not a valid block ID pattern
            expect(result[0]).toBe('text with ^caret mid-line');
        });

        it('removes valid trailing block ID with hyphens', () => {
            const result = ops.stripBlockIds(['text ^my-block-id']);
            expect(result[0]).toBe('text');
        });

        it('removes an ID the parser reads, trailing space and all', () => {
            // The reading has to match the one every parser uses: a stricter
            // one leaves the copy claiming the original's anchor.
            const result = ops.stripBlockIds(['- [ ] task ^abc ']);
            expect(result[0]).toBe('- [ ] task');
        });
    });

    // ── indent resolution (static) ──
    describe('resolveChildIndent', () => {
        const resolve = (lines: string[], line: number, parent?: string, except?: ReadonlySet<number>, unit = '\t') =>
            FileOperations.resolveChildIndent(Outline.read(lines), line, unit, parent, except);

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
