import { describe, it, expect } from 'vitest';
import { TaskCloner } from '../../../src/services/persistence/TaskCloner';
import { DEFAULT_TV_FILE_KEYS } from '../../../src/types';
import type { Task, TvFileKeys } from '../../../src/types';
import { TFile } from 'obsidian';

// Access private methods via prototype
const proto = TaskCloner.prototype as any;

function callShiftInlineDates(line: string, dayOffset: number): string {
    return proto.shiftInlineDates.call(null, line, dayOffset);
}

function callResetChildCheckboxes(lines: string[]): string[] {
    return proto.resetChildCheckboxes.call(null, lines);
}

function callShiftFrontmatterDates(content: string, dayOffset: number, keys?: TvFileKeys): string {
    return proto.shiftFrontmatterDates.call(null, content, dayOffset, keys ?? DEFAULT_TV_FILE_KEYS);
}

function callGenerateDatedPath(file: TFile, task: Partial<Task>, dayOffset: number): string {
    return proto.generateDatedPath.call(null, file, task, dayOffset);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskCloner', () => {

    describe('shiftInlineDates', () => {
        it('shifts date-only @notation by +1 day', () => {
            expect(callShiftInlineDates('- [ ] Task @2026-03-11', 1))
                .toBe('- [ ] Task @2026-03-12');
        });

        it('shifts start and end dates', () => {
            expect(callShiftInlineDates('- [ ] Task @2026-03-11T09:00>2026-03-11T17:00', 1))
                .toBe('- [ ] Task @2026-03-12T09:00>2026-03-12T17:00');
        });

        it('does NOT shift due (3rd segment)', () => {
            expect(callShiftInlineDates('- [ ] Task @2026-03-11>2026-03-12>2026-03-20', 1))
                .toBe('- [ ] Task @2026-03-12>2026-03-13>2026-03-20');
        });

        it('time-only notation is unchanged', () => {
            expect(callShiftInlineDates('- [ ] Task @09:00>10:00', 1))
                .toBe('- [ ] Task @09:00>10:00');
        });

        it('handles month boundary', () => {
            expect(callShiftInlineDates('- [ ] Task @2026-03-31', 1))
                .toBe('- [ ] Task @2026-04-01');
        });

        it('line without @notation is unchanged', () => {
            const line = '- [ ] Plain task without date';
            expect(callShiftInlineDates(line, 5)).toBe(line);
        });
    });

    describe('resetChildCheckboxes', () => {
        it('resets - [x] to - [ ]', () => {
            expect(callResetChildCheckboxes(['- [x] done'])).toEqual(['- [ ] done']);
        });

        it('resets * [X] to * [ ]', () => {
            expect(callResetChildCheckboxes(['* [X] done'])).toEqual(['* [ ] done']);
        });

        it('resets numbered list 1. [>]', () => {
            expect(callResetChildCheckboxes(['1. [>] in progress'])).toEqual(['1. [ ] in progress']);
        });

        it('leaves non-checkbox lines unchanged', () => {
            const lines = ['  plain text', '  - note without checkbox'];
            expect(callResetChildCheckboxes(lines)).toEqual(lines);
        });
    });

    describe('shiftFrontmatterDates', () => {
        it('shifts tv-start and tv-end dates', () => {
            const content = [
                '---',
                'tv-start: 2026-03-11',
                'tv-end: 2026-03-12',
                '---',
                'body',
            ].join('\n');
            const result = callShiftFrontmatterDates(content, 2);
            expect(result).toContain('tv-start: 2026-03-13');
            expect(result).toContain('tv-end: 2026-03-14');
        });

        it('shifts tv-due date', () => {
            const content = [
                '---',
                'tv-start: 2026-03-11',
                'tv-due: 2026-03-20',
                '---',
            ].join('\n');
            const result = callShiftFrontmatterDates(content, 1);
            expect(result).toContain('tv-due: 2026-03-21');
        });

        it('no frontmatter → content unchanged', () => {
            const content = 'just body text';
            expect(callShiftFrontmatterDates(content, 1)).toBe(content);
        });

        it('does not shift non-task-key dates', () => {
            const content = [
                '---',
                'tv-start: 2026-03-11',
                'other-date: 2026-01-01',
                '---',
            ].join('\n');
            const result = callShiftFrontmatterDates(content, 1);
            expect(result).toContain('tv-start: 2026-03-12');
            expect(result).toContain('other-date: 2026-01-01');
        });

        it('shifts datetime preserving time part', () => {
            const content = [
                '---',
                'tv-start: 2026-03-11T09:00',
                '---',
            ].join('\n');
            const result = callShiftFrontmatterDates(content, 1);
            expect(result).toContain('tv-start: 2026-03-12T09:00');
        });
    });

    describe('generateDatedPath', () => {
        function makeTFile(path: string): TFile {
            const f = new TFile();
            f.path = path;
            f.name = path.split('/').pop() ?? path;
            f.basename = f.name.replace(/\.md$/, '');
            f.parent = { path: path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '' } as any;
            return f;
        }

        it('replaces existing date in filename', () => {
            const file = makeTFile('Project 2026-03-11.md');
            const result = callGenerateDatedPath(file, { startDate: '2026-03-11' }, 1);
            expect(result).toBe('Project 2026-03-12.md');
        });

        it('appends date when filename has no date', () => {
            const file = makeTFile('Project.md');
            const result = callGenerateDatedPath(file, { startDate: '2026-03-11' }, 1);
            expect(result).toBe('Project 2026-03-12.md');
        });

        it('handles subfolder paths', () => {
            const file = makeTFile('notes/Project 2026-03-11.md');
            const result = callGenerateDatedPath(file, { startDate: '2026-03-11' }, 2);
            expect(result).toBe('notes/Project 2026-03-13.md');
        });
    });
});
