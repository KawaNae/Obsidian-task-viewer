import { describe, it, expect } from 'vitest';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
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
            const result = ops.collectChildrenFromLines(lines, 0);
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
            const result = ops.collectChildrenFromLines(lines, 0);
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
            const result = ops.collectChildrenFromLines(lines, 0);
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
            const result = ops.collectChildrenFromLines(lines, 0);
            expect(result.childrenLines).toEqual(['    child']);
        });

        it('returns empty when no children', () => {
            const lines = ['- [ ] alone', '- [ ] next'];
            const result = ops.collectChildrenFromLines(lines, 0);
            expect(result.childrenLines).toEqual([]);
        });

        it('handles tab-indented children', () => {
            const lines = [
                '- [ ] parent',
                '\t- [ ] child',
                '\t\t- [ ] grandchild',
                '- [ ] next',
            ];
            const result = ops.collectChildrenFromLines(lines, 0);
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
            const result = ops.collectChildrenFromLines(lines, 1);
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
    describe('detectIndentUnit', () => {
        it('takes the spelling of the first indented line', () => {
            expect(FileOperations.detectIndentUnit(['- a', '\t- b'])).toBe('\t');
            expect(FileOperations.detectIndentUnit(['- a', '    - b'])).toBe('    ');
        });

        it('ignores blank lines while looking', () => {
            expect(FileOperations.detectIndentUnit(['- a', '   ', '\t- b'])).toBe('\t');
        });

        it('defaults to a tab when nothing is indented', () => {
            expect(FileOperations.detectIndentUnit(['- a', '- b'])).toBe('\t');
        });
    });

    describe('resolveChildIndent', () => {
        it('copies the first existing child', () => {
            const lines = ['- [ ] parent', '\t- [ ] child'];
            expect(FileOperations.resolveChildIndent(lines, 0)).toBe('\t');
        });

        it('prefers the task\'s own children over the rest of the file', () => {
            const lines = ['- [ ] other', '    - [ ] other child', '- [ ] parent', '\t- [ ] child'];
            expect(FileOperations.resolveChildIndent(lines, 2)).toBe('\t');
        });

        it('falls back to the file when the task has no children', () => {
            const lines = ['- [ ] parent', '- [ ] other', '    - [ ] other child'];
            expect(FileOperations.resolveChildIndent(lines, 0)).toBe('    ');
        });

        it('nests below an already indented parent', () => {
            const lines = ['- [ ] top', '\t- [ ] parent', '\t\t- [ ] child'];
            expect(FileOperations.resolveChildIndent(lines, 1)).toBe('\t\t');
        });

        it('does not treat a line past a blank as a child', () => {
            const lines = ['- [ ] parent', '', '    - [ ] not a child'];
            // Nothing indented before the blank, so the file's own unit decides.
            expect(FileOperations.resolveChildIndent(lines, 0)).toBe('    ');
        });
    });
});
