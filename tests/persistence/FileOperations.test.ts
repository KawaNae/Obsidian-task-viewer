import { describe, it, expect } from 'vitest';
import { FileOperations } from '../../src/services/persistence/utils/FileOperations';
import type { App } from 'obsidian';
import type { Task } from '../../src/types';

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
        childLineBodyOffsets: [],
        originalText: '- [ ] Test task',
        tags: [],
        parserId: 'at-notation',
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
            const result = FileOperations.adjustChildIndentation(['', '  text'], 0);
            expect(result[0]).toBe('');
        });

        it('strips old indent and converts to tabs', () => {
            const result = FileOperations.adjustChildIndentation(['        child'], 4);
            // relative indent = 8 - 4 = 4, tab divisor = 4 → 1 tab
            expect(result[0]).toBe('\tchild');
        });

        it('handles zero old indent', () => {
            const result = FileOperations.adjustChildIndentation(['    child'], 0);
            expect(result[0]).toBe('\tchild');
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

        it('Strategy 3: fallback to stored line', () => {
            const task = makeTask({
                line: 2,
                originalText: 'completely different',
                content: 'not found anywhere',
            });
            expect(ops.findTaskLineNumber(lines, task)).toBe(2);
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
