import { describe, it, expect } from 'vitest';
import { formatTask, formatTaskList, cliOk, cliError } from '../../src/cli/CliOutputFormatter';
import type { Task } from '../../src/types';
import { makeTask } from '../helpers/makeTask';

describe('CliOutputFormatter', () => {
    describe('formatTask', () => {
        it('formats a basic task with all fields', () => {
            const task = makeTask({
                id: 'at-notation:daily/2026-03-14.md:ln:5',
                file: 'daily/2026-03-14.md',
                line: 5,
                content: 'Buy groceries',
                statusChar: ' ',
                startDate: '2026-03-14',
                startTime: '10:00',
                endDate: '2026-03-14',
                endTime: '11:00',
                tags: ['#shopping'],
                parserId: 'at-notation',
            });

            const result = formatTask(task);

            expect(result.id).toBe('at-notation:daily/2026-03-14.md:ln:5');
            expect(result.file).toBe('daily/2026-03-14.md');
            expect(result.line).toBe(5);
            expect(result.content).toBe('Buy groceries');
            expect(result.status).toBe(' ');
            expect(result.startDate).toBe('2026-03-14');
            expect(result.startTime).toBe('10:00');
            expect(result.endDate).toBe('2026-03-14');
            expect(result.endTime).toBe('11:00');
            expect(result.tags).toEqual(['#shopping']);
            expect(result.parserId).toBe('at-notation');
        });

        it('uses null for missing optional fields', () => {
            const task = makeTask({});
            const result = formatTask(task);

            expect(result.startDate).toBeNull();
            expect(result.startTime).toBeNull();
            expect(result.endDate).toBeNull();
            expect(result.endTime).toBeNull();
            expect(result.due).toBeNull();
            expect(result.parentId).toBeNull();
            expect(result.color).toBeNull();
            expect(result.linestyle).toBeNull();
        });
    });

    describe('formatTaskList', () => {
        it('wraps tasks in count + tasks structure', () => {
            const tasks = [makeTask({ content: 'A' }), makeTask({ content: 'B' })];
            const result = formatTaskList(tasks);

            expect(result.count).toBe(2);
            expect(result.tasks).toHaveLength(2);
            expect(result.tasks[0].content).toBe('A');
            expect(result.tasks[1].content).toBe('B');
        });

        it('returns count 0 for empty array', () => {
            const result = formatTaskList([]);
            expect(result.count).toBe(0);
            expect(result.tasks).toEqual([]);
        });
    });

    describe('cliOk', () => {
        it('returns JSON string', () => {
            const result = cliOk({ status: 'ok', id: 'test' });
            expect(JSON.parse(result)).toEqual({ status: 'ok', id: 'test' });
        });
    });

    describe('cliError', () => {
        it('returns JSON with error field', () => {
            const result = cliError('Something went wrong');
            expect(JSON.parse(result)).toEqual({ error: 'Something went wrong' });
        });
    });
});
