import { describe, it, expect } from 'vitest';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import type { App } from 'obsidian';
import type { Task } from '../../../src/types';

// Instance with dummy App (methods under test don't use vault)
const ops = new FileOperations({} as App);

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'test-1',
        file: 'notes/daily.md',
        line: 1,
        content: 'Test task',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        originalText: '- [ ] Test task',
        tags: [],
        parserId: 'tv-inline',
        ...overrides,
    };
}

describe('FileOperations', () => {

    // ── getChildIndent (static) ──
    describe('getChildIndent', () => {
        it('adds tab when parent uses tabs', () => {
            expect(FileOperations.getChildIndent('\t- [ ] task')).toBe('\t\t');
        });

        it('adds 4 spaces when parent uses spaces', () => {
            expect(FileOperations.getChildIndent('    - [ ] task')).toBe('        ');
        });

        it('adds 4 spaces when parent has no indent', () => {
            expect(FileOperations.getChildIndent('- [ ] task')).toBe('    ');
        });

        it('adds tab for nested tab parent', () => {
            expect(FileOperations.getChildIndent('\t\t- [ ] deep')).toBe('\t\t\t');
        });
    });

    // ── adjustChildIndentation (static) ──
    describe('adjustChildIndentation', () => {
        it('preserves empty lines', () => {
            const result = FileOperations.adjustChildIndentation(['', '  text'], '');
            expect(result[0]).toBe('');
        });

        it('strips parent indent prefix and preserves deeper indent verbatim', () => {
            const result = FileOperations.adjustChildIndentation(['        child'], '    ');
            expect(result[0]).toBe('    child');
        });

        it('handles empty parent indent', () => {
            const result = FileOperations.adjustChildIndentation(['    child'], '');
            expect(result[0]).toBe('    child');
        });
    });

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
            expect(result.taskIndent).toBe(0);
        });

        // Characterization: a blank line terminates the subtree even when
        // deeper-indented lines follow. Pinned deliberately — the session-record
        // work may revisit it, so any change must be a conscious one.
        it('stops at blank line', () => {
            const lines = [
                '- [ ] parent',
                '    - [ ] child',
                '',
                '    - [ ] not-child',
            ];
            const result = ops.collectChildrenFromLines(lines, 0);
            expect(result.childrenLines).toEqual(['    - [ ] child']);
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
            const lines = [
                '\t- [ ] parent',
                '\t\t- [ ] child',
                '\t\t\t- [ ] grandchild',
                '\t- [ ] sibling',
            ];
            const result = ops.collectChildrenFromLines(lines, 0);
            expect(result.childrenLines).toHaveLength(2);
            expect(result.taskIndent).toBe(1);
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
    });

    // ── findTaskLineNumber ──
    describe('findTaskLineNumber', () => {
        const lines = [
            '# heading',
            '- [ ] first task @2026-01-01',
            '    child',
            '- [ ] second task @2026-02-01',
            '- [ ] third task',
        ];

        it('Strategy -1: finds by blockId', () => {
            const task = makeTask({
                blockId: 'abc123',
                line: 99,
                originalText: 'wrong',
            });
            const linesWithBlock = [...lines];
            linesWithBlock[3] = '- [ ] second task @2026-02-01 ^abc123';
            expect(ops.findTaskLineNumber(linesWithBlock, task)).toBe(3);
        });

        it('Strategy 0: stored line number + originalText match', () => {
            const task = makeTask({
                line: 1,
                originalText: '- [ ] first task @2026-01-01',
            });
            expect(ops.findTaskLineNumber(lines, task)).toBe(1);
        });

        it('Strategy 1: originalText full match (line shifted)', () => {
            const task = makeTask({
                line: 99, // wrong line number
                originalText: '- [ ] second task @2026-02-01',
            });
            expect(ops.findTaskLineNumber(lines, task)).toBe(3);
        });

        it('Strategy 2: content + date pattern match', () => {
            const task = makeTask({
                line: 99,
                originalText: 'different original',
                content: 'first task',
                startDate: '2026-01-01',
            });
            expect(ops.findTaskLineNumber(lines, task)).toBe(1);
        });

        // Behavior change (was: unverified fallback to task.line).
        // The stored line is only trusted when it still holds a task line with
        // the same content; otherwise the write must not happen at all.
        it('Strategy 3: stored line is used when it still holds the same task', () => {
            const task = makeTask({
                line: 3,
                originalText: 'stale text',
                content: 'second task',
                startDate: '2099-01-01', // date no longer matches -> Strategy 2 misses
            });
            expect(ops.findTaskLineNumber(lines, task)).toBe(3);
        });

        it('Strategy 3: returns -1 when the stored line holds something else', () => {
            const task = makeTask({
                line: 2, // '    child' — not even a task line
                originalText: 'completely different',
                content: 'not found anywhere',
            });
            expect(ops.findTaskLineNumber(lines, task)).toBe(-1);
        });

        // ── W1: prefix collision (evidence-line-misroute.md) ──
        describe('W1: content prefix collision', () => {
            // Exact input from the recorded incident: a write aimed at
            // `DragFlashA` landed on the `DragFlashAllDay` line, +2 rows away.
            const dragFlashLines = [
                '# drag flash test',
                '',
                '- [ ] DragFlashA @2026-07-25T23:30>00:30',
                '- [ ] DragFlashB @2026-07-24T13:00>14:00',
                '- [ ] DragFlashAllDay @2026-07-26>2026-07-27',
                '- [ ] DragFlashCancel @2026-07-24T16:00>17:00',
            ];

            it('does not resolve to a line whose content merely starts with it', () => {
                const task = makeTask({
                    line: 2,
                    originalText: 'STALE LINE',
                    content: 'DragFlashA',
                    startDate: '2026-07-26',
                });
                // Must never be 4 (the DragFlashAllDay line). The stored line 2
                // holds DragFlashA, so Strategy 3 accepts it.
                expect(ops.findTaskLineNumber(dragFlashLines, task)).toBe(2);
            });

            it('refuses to write anywhere when the stored line is stale too', () => {
                const task = makeTask({
                    line: 3, // DragFlashB — wrong task
                    originalText: 'STALE LINE',
                    content: 'DragFlashA',
                    startDate: '2026-07-26',
                });
                expect(ops.findTaskLineNumber(dragFlashLines, task)).toBe(-1);
            });

            it('matches an allday line by its start date (> must stay legal)', () => {
                const task = makeTask({
                    line: 99,
                    originalText: 'STALE LINE',
                    content: 'DragFlashAllDay',
                    startDate: '2026-07-26',
                });
                expect(ops.findTaskLineNumber(dragFlashLines, task)).toBe(4);
            });

            it('matches a timed line by its date-only startDate (T must stay legal)', () => {
                const task = makeTask({
                    line: 99,
                    originalText: 'STALE LINE',
                    content: 'DragFlashB',
                    startDate: '2026-07-24',
                });
                expect(ops.findTaskLineNumber(dragFlashLines, task)).toBe(3);
            });

            it('handles Japanese prefix collisions (買い物 vs 買い物リスト)', () => {
                const jpLines = [
                    '- [ ] 買い物リスト @2026-08-12',
                    '- [ ] 買い物 @2026-08-13',
                ];
                const task = makeTask({
                    line: 99,
                    originalText: 'STALE LINE',
                    content: '買い物',
                    startDate: '2026-08-12', // matches the LIST line's date
                });
                // The only line whose content is exactly 買い物 has a different
                // date, so no write target may be chosen.
                expect(ops.findTaskLineNumber(jpLines, task)).toBe(-1);
            });

            it('picks the line whose date matches when content is duplicated', () => {
                const dupLines = [
                    '- [ ] 買い物 @2026-08-12',
                    '- [ ] 買い物 @2026-08-13',
                    '- [ ] 買い物 @2026-08-14',
                ];
                const task = makeTask({
                    line: 99,
                    originalText: 'STALE LINE',
                    content: '買い物',
                    startDate: '2026-08-13',
                });
                expect(ops.findTaskLineNumber(dupLines, task)).toBe(1);
            });

            it('tolerates extra spaces after the checkbox', () => {
                const spacedLines = ['- [ ]   padded task @2026-08-12'];
                const task = makeTask({
                    line: 99,
                    originalText: 'STALE LINE',
                    content: 'padded task',
                    startDate: '2026-08-12',
                });
                expect(ops.findTaskLineNumber(spacedLines, task)).toBe(0);
            });

            it('accepts a trailing block ID after the content', () => {
                const blockLines = ['- [ ] plain task @2026-08-12 ^abc123'];
                const task = makeTask({
                    line: 99,
                    originalText: 'STALE LINE',
                    content: 'plain task',
                    startDate: '2026-08-12',
                });
                expect(ops.findTaskLineNumber(blockLines, task)).toBe(0);
            });

        });

        it('prefers blockId over exact text match', () => {
            const linesWithBlock = [
                '- [ ] task ^target',
                '- [ ] task', // same originalText but no blockId
            ];
            const task = makeTask({
                blockId: 'target',
                line: 1,
                originalText: '- [ ] task',
            });
            expect(ops.findTaskLineNumber(linesWithBlock, task)).toBe(0);
        });

        it('prefers stored line over scan when originalText matches', () => {
            // Two identical lines — stored line should be preferred
            const dupLines = [
                '- [ ] duplicate',
                '- [ ] duplicate',
            ];
            const task = makeTask({
                line: 1,
                originalText: '- [ ] duplicate',
            });
            expect(ops.findTaskLineNumber(dupLines, task)).toBe(1);
        });
    });

    // ── findSiblingGroupStart ──
    describe('findSiblingGroupStart', () => {
        it('returns position after header for top-level task', () => {
            const lines = [
                '## Tasks',
                '- [ ] first',
                '- [ ] second',
            ];
            expect(ops.findSiblingGroupStart(lines, 2)).toBe(1);
        });

        it('returns first sibling when siblings exist above', () => {
            const lines = [
                '## Tasks',
                '- [x] older',
                '- [x] middle',
                '- [ ] current',
            ];
            expect(ops.findSiblingGroupStart(lines, 3)).toBe(1);
        });

        it('skips children of previous siblings', () => {
            const lines = [
                '## Tasks',
                '- [x] sibling1',
                '    - [x] child of sibling1',
                '    - [x] another child',
                '- [x] sibling2',
                '- [ ] current',
            ];
            expect(ops.findSiblingGroupStart(lines, 5)).toBe(1);
        });

        it('stops at blank line boundary', () => {
            const lines = [
                '- [x] unrelated',
                '',
                '- [x] group start',
                '- [ ] current',
            ];
            expect(ops.findSiblingGroupStart(lines, 3)).toBe(2);
        });

        it('returns parent+1 for child task', () => {
            const lines = [
                '- [ ] parent',
                '    - [x] child1',
                '    - [ ] child2',
            ];
            expect(ops.findSiblingGroupStart(lines, 2)).toBe(1);
        });

        it('returns parent+1 for child even with other siblings', () => {
            const lines = [
                '- [ ] parent',
                '    - [x] child1',
                '    - [x] child2',
                '    - [ ] child3',
            ];
            expect(ops.findSiblingGroupStart(lines, 3)).toBe(1);
        });

        it('returns 0 for task at file start', () => {
            const lines = [
                '- [ ] only task',
            ];
            expect(ops.findSiblingGroupStart(lines, 0)).toBe(0);
        });
    });
});
