import { describe, it, expect } from 'vitest';
import { FrontmatterTaskBuilder } from '../../src/services/parsing/file/FrontmatterTaskBuilder';
import { DEFAULT_FRONTMATTER_TASK_KEYS } from '../../src/types';

const keys = DEFAULT_FRONTMATTER_TASK_KEYS;
const defaultHeader = 'Tasks';
const defaultHeaderLevel = 2;

describe('FrontmatterTaskBuilder', () => {
    describe('parse', () => {
        it('returns null when frontmatter is undefined', () => {
            expect(FrontmatterTaskBuilder.parse('file.md', undefined, [], 0, keys, defaultHeader, defaultHeaderLevel)).toBeNull();
        });

        it('returns null when no date fields present', () => {
            const fm = { title: 'Note' };
            expect(FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel)).toBeNull();
        });

        it('parses basic start date', () => {
            const fm = { [keys.start]: '2026-01-15' };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result).not.toBeNull();
            expect(result!.task.startDate).toBe('2026-01-15');
            expect(result!.task.parserId).toBe('frontmatter');
            expect(result!.task.file).toBe('file.md');
        });

        it('parses start date with time', () => {
            const fm = { [keys.start]: '2026-01-15T09:00' };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result).not.toBeNull();
            expect(result!.task.startDate).toBe('2026-01-15');
            expect(result!.task.startTime).toBe('09:00');
        });

        it('parses end and due fields', () => {
            const fm = {
                [keys.start]: '2026-01-15',
                [keys.end]: '2026-01-16T17:00',
                [keys.due]: '2026-01-20',
            };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result).not.toBeNull();
            expect(result!.task.endDate).toBe('2026-01-16');
            expect(result!.task.endTime).toBe('17:00');
            expect(result!.task.due).toBe('2026-01-20');
        });

        it('parses status char', () => {
            const fm = { [keys.start]: '2026-01-15', [keys.status]: 'x' };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.task.statusChar).toBe('x');
        });

        it('defaults status to space when empty', () => {
            const fm = { [keys.start]: '2026-01-15' };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.task.statusChar).toBe(' ');
        });

        it('parses content field', () => {
            const fm = { [keys.start]: '2026-01-15', [keys.content]: 'My Task' };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.task.content).toBe('My Task');
        });

        it('handles Date object from YAML', () => {
            const fm = { [keys.start]: new Date(2026, 0, 15) }; // Jan 15 2026
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result).not.toBeNull();
            expect(result!.task.startDate).toBe('2026-01-15');
        });

        it('extracts tags from frontmatter', () => {
            const fm = { [keys.start]: '2026-01-15', tags: ['work', 'important'] };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.task.tags).toContain('work');
            expect(result!.task.tags).toContain('important');
        });

        it('extracts shared tags', () => {
            const fm = { [keys.start]: '2026-01-15', [keys.sharedtags]: ['shared1'] };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.task.tags).toContain('shared1');
        });

        it('extracts content tags', () => {
            const fm = { [keys.start]: '2026-01-15', [keys.content]: 'task #inline-tag' };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.task.tags).toContain('inline-tag');
        });

        it('parses due-only task', () => {
            const fm = { [keys.due]: '2026-01-20' };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result).not.toBeNull();
            expect(result!.task.due).toBe('2026-01-20');
            expect(result!.task.startDate).toBeUndefined();
        });

        it('parses due with time', () => {
            const fm = { [keys.due]: '2026-01-20T18:00' };
            const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.task.due).toBe('2026-01-20T18:00');
        });
    });

    describe('body lines and wikilink refs', () => {
        it('collects child lines under header section', () => {
            const fm = { [keys.start]: '2026-01-15' };
            const bodyLines = [
                '## Tasks',
                '- [ ] subtask 1',
                '- [x] subtask 2',
                '',
                '## Other',
            ];
            const result = FrontmatterTaskBuilder.parse('file.md', fm, bodyLines, 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result).not.toBeNull();
            expect(result!.task.childLines).toHaveLength(2);
            expect(result!.task.childLines[0].checkboxChar).toBe(' ');
            expect(result!.task.childLines[1].checkboxChar).toBe('x');
        });

        it('extracts wikilink refs from child lines', () => {
            const fm = { [keys.start]: '2026-01-15' };
            const bodyLines = [
                '## Tasks',
                '- [[Linked Task]]',
                '- [[path/to/note|Alias]]',
            ];
            const result = FrontmatterTaskBuilder.parse('file.md', fm, bodyLines, 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.wikilinkRefs).toHaveLength(2);
            expect(result!.wikilinkRefs[0].target).toBe('Linked Task');
            expect(result!.wikilinkRefs[1].target).toBe('path/to/note|Alias');
        });

        it('returns empty childLines when no header section', () => {
            const fm = { [keys.start]: '2026-01-15' };
            const bodyLines = ['Just some text', 'No heading here'];
            const result = FrontmatterTaskBuilder.parse('file.md', fm, bodyLines, 0, keys, defaultHeader, defaultHeaderLevel);
            expect(result!.task.childLines).toHaveLength(0);
        });
    });

    describe('normalizeYamlDate', () => {
        it('returns null for null/undefined', () => {
            expect(FrontmatterTaskBuilder.normalizeYamlDate(null)).toBeNull();
            expect(FrontmatterTaskBuilder.normalizeYamlDate(undefined)).toBeNull();
        });

        it('normalizes Date object (date only)', () => {
            const d = new Date(2026, 0, 15, 0, 0);
            expect(FrontmatterTaskBuilder.normalizeYamlDate(d)).toBe('2026-01-15');
        });

        it('normalizes Date object with time', () => {
            const d = new Date(2026, 0, 15, 9, 30);
            expect(FrontmatterTaskBuilder.normalizeYamlDate(d)).toBe('2026-01-15T09:30');
        });

        it('normalizes number as minutes', () => {
            expect(FrontmatterTaskBuilder.normalizeYamlDate(540)).toBe('09:00'); // 9*60
        });

        it('passes through string', () => {
            expect(FrontmatterTaskBuilder.normalizeYamlDate('2026-01-15')).toBe('2026-01-15');
        });

        it('returns null for empty string', () => {
            expect(FrontmatterTaskBuilder.normalizeYamlDate('')).toBeNull();
        });
    });

    describe('parseDateTimeField', () => {
        it('parses date only', () => {
            expect(FrontmatterTaskBuilder.parseDateTimeField('2026-01-15')).toEqual({ date: '2026-01-15', time: undefined });
        });

        it('parses date and time', () => {
            expect(FrontmatterTaskBuilder.parseDateTimeField('2026-01-15T09:30')).toEqual({ date: '2026-01-15', time: '09:30' });
        });

        it('parses time only', () => {
            expect(FrontmatterTaskBuilder.parseDateTimeField('09:30')).toEqual({ date: undefined, time: '09:30' });
        });

        it('returns empty for null', () => {
            expect(FrontmatterTaskBuilder.parseDateTimeField(null)).toEqual({});
        });
    });
});
