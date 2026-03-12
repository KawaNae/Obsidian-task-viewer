import { describe, it, expect } from 'vitest';
import { TaskNormalizer } from '../../src/services/aiindex/TaskNormalizer';
import type { TaskNormalizerOptions } from '../../src/services/aiindex/TaskNormalizer';
import type { Task } from '../../src/types';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: overrides.id ?? 'at-notation:file.md:ln:1',
        file: 'file.md',
        line: overrides.line ?? 0,
        content: overrides.content ?? 'Test task',
        statusChar: overrides.statusChar ?? ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: overrides.originalText ?? '- [ ] Test task',
        tags: overrides.tags ?? [],
        parserId: overrides.parserId ?? 'at-notation',
        ...overrides,
    };
}

const defaultOptions: TaskNormalizerOptions = {
    completeStatusChars: ['x', 'X'],
    includeParsers: new Set(['inline', 'frontmatter']),
    includeDone: true,
    includeRaw: false,
    keepDoneDays: 0,
    snapshotAt: '2026-03-11T00:00:00Z',
};

describe('TaskNormalizer', () => {
    const normalizer = new TaskNormalizer();

    describe('normalizeTask', () => {
        it('normalizes basic inline task', () => {
            const task = makeTask();
            const result = normalizer.normalizeTask(task, defaultOptions);
            expect(result).not.toBeNull();
            expect(result!.task.parser).toBe('inline');
            expect(result!.task.content).toBe('Test task');
            expect(result!.task.status).toBe('todo');
        });

        it('normalizes frontmatter task', () => {
            const task = makeTask({ id: 'frontmatter:project.md:fm-root', parserId: 'frontmatter', content: 'Project' });
            const result = normalizer.normalizeTask(task, defaultOptions);
            expect(result!.task.parser).toBe('frontmatter');
        });

        it('skips task with unsupported parser', () => {
            const options = { ...defaultOptions, includeParsers: new Set(['inline']) };
            const task = makeTask({ id: 'frontmatter:file.md:fm-root', parserId: 'frontmatter' });
            expect(normalizer.normalizeTask(task, options)).toBeNull();
        });

        it('skips done task when includeDone is false', () => {
            const options = { ...defaultOptions, includeDone: false };
            const task = makeTask({ statusChar: 'x' });
            expect(normalizer.normalizeTask(task, options)).toBeNull();
        });

        it('includes done task when includeDone is true', () => {
            const task = makeTask({ statusChar: 'x' });
            const result = normalizer.normalizeTask(task, defaultOptions);
            expect(result).not.toBeNull();
            expect(result!.task.status).toBe('done');
        });

        it('resolves status: cancelled for -', () => {
            const task = makeTask({ statusChar: '-' });
            const options = { ...defaultOptions, completeStatusChars: ['x', '-'] };
            const result = normalizer.normalizeTask(task, options);
            expect(result!.task.status).toBe('cancelled');
        });

        it('resolves status: unknown for unrecognized char', () => {
            const task = makeTask({ statusChar: '?' });
            const result = normalizer.normalizeTask(task, defaultOptions);
            expect(result!.task.status).toBe('unknown');
        });

        it('composes start datetime', () => {
            const task = makeTask({ startDate: '2026-03-11', startTime: '09:00' });
            const result = normalizer.normalizeTask(task, defaultOptions);
            expect(result!.task.start).toBe('2026-03-11T09:00');
        });

        it('empty content → basename fallback', () => {
            const task = makeTask({ content: '', id: 'at-notation:notes/my-project.md:ln:1' });
            const result = normalizer.normalizeTask(task, defaultOptions);
            expect(result!.task.content).toBe('my-project');
        });

        it('includes raw when option set', () => {
            const options = { ...defaultOptions, includeRaw: true };
            const task = makeTask({ originalText: '- [ ] raw text' });
            const result = normalizer.normalizeTask(task, options);
            expect(result!.task.raw).toBe('- [ ] raw text');
        });

        it('retention cutoff filters old done tasks', () => {
            const options = { ...defaultOptions, includeDone: true, keepDoneDays: 7, snapshotAt: '2026-03-11T00:00:00Z' };
            const task = makeTask({ statusChar: 'x', startDate: '2026-02-01' });
            expect(normalizer.normalizeTask(task, options)).toBeNull();
        });

        it('retention cutoff keeps recent done tasks', () => {
            const options = { ...defaultOptions, includeDone: true, keepDoneDays: 7, snapshotAt: '2026-03-11T00:00:00Z' };
            const task = makeTask({ statusChar: 'x', startDate: '2026-03-10' });
            expect(normalizer.normalizeTask(task, options)).not.toBeNull();
        });
    });

    describe('normalizeTasks', () => {
        it('groups by source path', () => {
            const tasks = [
                makeTask({ id: 'at-notation:a.md:ln:1', content: 'A' }),
                makeTask({ id: 'at-notation:b.md:ln:1', content: 'B' }),
                makeTask({ id: 'at-notation:a.md:ln:2', content: 'C', line: 1 }),
            ];
            const result = normalizer.normalizeTasks(tasks, defaultOptions);
            expect(result.get('a.md')).toHaveLength(2);
            expect(result.get('b.md')).toHaveLength(1);
        });

        it('sorts by line within path', () => {
            const tasks = [
                makeTask({ id: 'at-notation:a.md:ln:10', line: 9, content: 'Second' }),
                makeTask({ id: 'at-notation:a.md:ln:1', line: 0, content: 'First' }),
            ];
            const result = normalizer.normalizeTasks(tasks, defaultOptions);
            const aTasks = result.get('a.md')!;
            expect(aTasks[0].content).toBe('First');
            expect(aTasks[1].content).toBe('Second');
        });
    });

    describe('hashTasksForPath', () => {
        it('produces stable hash', () => {
            const tasks = [
                { id: 'a', contentHash: 'abc' } as any,
                { id: 'b', contentHash: 'def' } as any,
            ];
            const h1 = normalizer.hashTasksForPath(tasks);
            const h2 = normalizer.hashTasksForPath(tasks);
            expect(h1).toBe(h2);
        });

        it('different input → different hash', () => {
            const h1 = normalizer.hashTasksForPath([{ id: 'a', contentHash: 'abc' } as any]);
            const h2 = normalizer.hashTasksForPath([{ id: 'a', contentHash: 'xyz' } as any]);
            expect(h1).not.toBe(h2);
        });
    });
});
