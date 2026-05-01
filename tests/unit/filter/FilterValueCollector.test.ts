import { describe, it, expect } from 'vitest';
import { FilterValueCollector } from '../../../src/services/filter/FilterValueCollector';
import type { Task } from '../../../src/types';

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
        parserId: 'tv-inline',
        ...overrides,
    };
}

describe('FilterValueCollector', () => {
    describe('collectTags', () => {
        it('collects unique sorted tags', () => {
            const tasks = [
                makeTask({ tags: ['work', 'urgent'] }),
                makeTask({ tags: ['urgent', 'personal'] }),
            ];
            expect(FilterValueCollector.collectTags(tasks)).toEqual(['personal', 'urgent', 'work']);
        });

        it('returns empty for no tasks', () => {
            expect(FilterValueCollector.collectTags([])).toEqual([]);
        });
    });

    describe('collectFiles', () => {
        it('collects unique sorted files', () => {
            const tasks = [
                makeTask({ file: 'b.md' }),
                makeTask({ file: 'a.md' }),
                makeTask({ file: 'b.md' }),
            ];
            expect(FilterValueCollector.collectFiles(tasks)).toEqual(['a.md', 'b.md']);
        });
    });

    describe('collectStatuses', () => {
        it('collects unique sorted status chars', () => {
            const tasks = [
                makeTask({ statusChar: 'x' }),
                makeTask({ statusChar: ' ' }),
                makeTask({ statusChar: '/' }),
                makeTask({ statusChar: 'x' }),
            ];
            expect(FilterValueCollector.collectStatuses(tasks)).toEqual([' ', '/', 'x']);
        });
    });

    describe('collectColors', () => {
        it('skips tasks without color', () => {
            const tasks = [
                makeTask({ color: 'red' }),
                makeTask(),
                makeTask({ color: 'blue' }),
                makeTask({ color: 'red' }),
            ];
            expect(FilterValueCollector.collectColors(tasks)).toEqual(['blue', 'red']);
        });

        it('returns empty when no tasks have color', () => {
            const tasks = [makeTask(), makeTask()];
            expect(FilterValueCollector.collectColors(tasks)).toEqual([]);
        });
    });

    describe('collectLineStyles', () => {
        it('skips tasks without linestyle', () => {
            const tasks = [
                makeTask({ linestyle: 'dashed' }),
                makeTask(),
                makeTask({ linestyle: 'dotted' }),
            ];
            expect(FilterValueCollector.collectLineStyles(tasks)).toEqual(['dashed', 'dotted']);
        });
    });

    describe('collectNotations', () => {
        it('collects unique sorted notations derived from parserId (tv-inline + tv-file collapse into taskviewer)', () => {
            const tasks = [
                makeTask({ parserId: 'tv-file' }),
                makeTask({ parserId: 'tv-inline' }),
                makeTask({ parserId: 'tv-inline' }),
                makeTask({ parserId: 'tasks-plugin' }),
            ];
            // tv-inline + tv-file both collapse into 'taskviewer'
            expect(FilterValueCollector.collectNotations(tasks)).toEqual(['tasks', 'taskviewer']);
        });
    });
});
