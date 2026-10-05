import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';

/**
 * The lines of a row's subtree below its own line, as a write takes them away
 * or carries them (`OutlineReading.subtreeEnd`): blank lines between them
 * included, the blank lines after the last of them not.
 */
const childrenOf = (lines: string[], row: number) => {
    const outline = Outline.read(lines);
    return { childrenLines: outline.lines.slice(row + 1, outline.subtreeEnd(row)) };
};

describe('OutlineReading.subtreeEnd', () => {
    describe('the lines below a row that go with it', () => {
        it('collects indented children', () => {
            const lines = [
                '- [ ] parent',
                '    - [ ] child 1',
                '    - [ ] child 2',
                '- [ ] sibling',
            ];
            const result = childrenOf(lines, 0);
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
            const result = childrenOf(lines, 0);
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
            const result = childrenOf(lines, 0);
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
            const result = childrenOf(lines, 0);
            expect(result.childrenLines).toEqual(['    child']);
        });

        it('returns empty when no children', () => {
            const lines = ['- [ ] alone', '- [ ] next'];
            const result = childrenOf(lines, 0);
            expect(result.childrenLines).toEqual([]);
        });

        it('handles tab-indented children', () => {
            const lines = [
                '- [ ] parent',
                '\t- [ ] child',
                '\t\t- [ ] grandchild',
                '- [ ] next',
            ];
            const result = childrenOf(lines, 0);
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
            const result = childrenOf(lines, 1);
            expect(result.childrenLines).toHaveLength(2);
            // Width, not characters: one tab is four columns.
        });
    });

});
