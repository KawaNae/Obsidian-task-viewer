import { describe, it, expect } from 'vitest';
import { resolveFields, pickFields, formatOutput, cliOk, cliError } from '../../src/cli/CliOutputFormatter';
import { taskToRecord } from '../../src/api/TaskNormalizer';
import { normalizeTask } from '../../src/api/TaskNormalizer';
import { makeTask } from '../helpers/makeTask';
import { toDisplayTask } from '../../src/utils/DisplayTaskConverter';

/** Helper: makeTask → DisplayTask → NormalizedTask */
function makeNormalized(overrides: Parameters<typeof makeTask>[0] = {}) {
    return normalizeTask(toDisplayTask(makeTask(overrides), 5));
}

describe('CliOutputFormatter', () => {
    describe('taskToRecord (from TaskNormalizer)', () => {
        it('formats a basic task with specified fields', () => {
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

            const fields = resolveFields('file,line,content,status,startDate,startTime,endDate,endTime,tags,parserId');
            const result = taskToRecord(task, fields);

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
            const fields = resolveFields('startDate,startTime,endDate,endTime,due,parentId,color,linestyle');
            const result = taskToRecord(task, fields);

            expect(result.startDate).toBeNull();
            expect(result.startTime).toBeNull();
            expect(result.endDate).toBeNull();
            expect(result.endTime).toBeNull();
            expect(result.due).toBeNull();
            expect(result.parentId).toBeNull();
            expect(result.color).toBeNull();
            expect(result.linestyle).toBeNull();
        });

        it('only includes requested fields', () => {
            const task = makeTask({ content: 'Test', startDate: '2026-03-14' });
            const result = taskToRecord(task, ['content', 'startDate']);

            expect(Object.keys(result)).toEqual(['content', 'startDate']);
            expect(result.content).toBe('Test');
            expect(result.startDate).toBe('2026-03-14');
        });
    });

    describe('formatOutput', () => {
        it('wraps tasks in count + tasks structure (json)', () => {
            const tasks = [makeNormalized({ content: 'A' }), makeNormalized({ content: 'B' })];
            const fields = resolveFields('content');
            const result = JSON.parse(formatOutput(tasks, 'json', fields));

            expect(result.count).toBe(2);
            expect(result.tasks).toHaveLength(2);
            expect(result.tasks[0].content).toBe('A');
            expect(result.tasks[1].content).toBe('B');
        });

        it('returns count 0 for empty array', () => {
            const result = JSON.parse(formatOutput([], 'json', resolveFields(undefined)));
            expect(result.count).toBe(0);
            expect(result.tasks).toEqual([]);
        });

        it('formats as tsv with header row', () => {
            const tasks = [makeNormalized({ content: 'A' })];
            const fields = ['content', 'status'];
            const result = formatOutput(tasks, 'tsv', fields);
            const lines = result.split('\n');
            expect(lines[0]).toBe('content\tstatus');
            expect(lines[1]).toContain('A');
        });

        it('formats as jsonl with one line per task', () => {
            const tasks = [makeNormalized({ content: 'A' }), makeNormalized({ content: 'B' })];
            const fields = ['content'];
            const result = formatOutput(tasks, 'jsonl', fields);
            const lines = result.split('\n');
            expect(lines).toHaveLength(2);
            expect(JSON.parse(lines[0]).content).toBe('A');
            expect(JSON.parse(lines[1]).content).toBe('B');
        });
    });

    describe('resolveFields', () => {
        it('returns id only for undefined', () => {
            const fields = resolveFields(undefined);
            expect(fields).toEqual(['id']);
        });

        it('always includes id even if not specified', () => {
            const fields = resolveFields('content,status');
            expect(fields).toEqual(['id', 'content', 'status']);
        });

        it('does not duplicate id if already specified', () => {
            const fields = resolveFields('id,content');
            expect(fields).toEqual(['id', 'content']);
        });

        it('throws on unknown field names', () => {
            expect(() => resolveFields('content,invalid')).toThrow('Unknown field(s): invalid');
        });

        it('throws on "all" and "default" (no longer special)', () => {
            expect(() => resolveFields('all')).toThrow('Unknown field(s): all');
            expect(() => resolveFields('default')).toThrow('Unknown field(s): default');
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
