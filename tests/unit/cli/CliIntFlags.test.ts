import { describe, it, expect, vi } from 'vitest';
import { parseLimit, readIntFlag } from '../../../src/cli/CliOutputFormatter';
import { createDuplicateHandler, createTasksForDateRangeHandler } from '../../../src/cli/handlers/TaskActionHandlers';
import { toCliName } from '../../../src/api/OperationSchemas';
import { TaskApiError } from '../../../src/api/TaskApiTypes';

/**
 * The CLI's whole-number flags are read by `IntInput`: `parseInt` read
 * `3days` as 3 and `1.5` as 1 (stage 7, input decision F). The range is the
 * API's to check, once (B#13b; `CliApiChecks.test.ts`).
 */

describe('parseLimit', () => {
    it.each([['0', 0], ['20', 20], [' 20 ', 20], ['２０', 20], ['-1', -1]])('reads %j as %d (its range is the API\'s)', (raw, n) => {
        expect(parseLimit(raw)).toBe(n);
    });

    it('reads all as no limit', () => {
        expect(parseLimit('all')).toBe(Infinity);
    });

    it.each(['3days', '1.5', 'abc', '0x10'])('refuses %j', (raw) => {
        expect(() => parseLimit(raw)).toThrow(`limit must be a whole number or "all", got: ${JSON.stringify(raw)}`);
    });
});

describe('readIntFlag', () => {
    it('reads the kebab-case flag of an API key', () => {
        expect(readIntFlag({ 'day-offset': '-2' }, 'dayOffset')).toBe(-2);
    });

    it('leaves an absent flag to the API default', () => {
        expect(readIntFlag({}, 'count')).toBeUndefined();
    });

    it('reads the text only: a number out of range is passed on for the API to check', () => {
        expect(readIntFlag({ count: '0' }, 'count')).toBe(0);
    });

    it('names the flag in its error', () => {
        expect(() => readIntFlag({ 'day-offset': 'x' }, 'dayOffset')).toThrow(TaskApiError);
        try { readIntFlag({ 'day-offset': 'x' }, 'dayOffset'); } catch (e) {
            expect((e as TaskApiError).param).toBe('dayOffset');
            expect((e as TaskApiError).textFor(toCliName)).toBe('day-offset must be a whole number, got: "x"');
        }
    });
});

function errorOf(out: string): string {
    return (JSON.parse(out) as { error: string }).error;
}

describe('duplicate', () => {
    const plugin = () => ({ api: { duplicate: vi.fn().mockResolvedValue({ duplicated: 'a.md#^x' }) } }) as any;

    it('passes whole numbers on', async () => {
        const p = plugin();
        await createDuplicateHandler(p)({ id: 'a.md#^x', 'day-offset': '3', count: '2' });
        expect(p.api.duplicate).toHaveBeenCalledWith({ id: 'a.md#^x', dayOffset: 3, count: 2 });
    });

    it.each([
        [{ 'day-offset': '3days' }, 'day-offset must be a whole number, got: "3days"'],
        [{ 'day-offset': '1.5' }, 'day-offset must be a whole number, got: "1.5"'],
        [{ count: '2x' }, 'count must be a whole number, got: "2x"'],
    ])('refuses %j without calling the API', async (flags, message) => {
        const p = plugin();
        expect(errorOf(await createDuplicateHandler(p)({ id: 'a.md#^x', ...flags }))).toBe(message);
        expect(p.api.duplicate).not.toHaveBeenCalled();
    });
});

describe('a listing\'s limit', () => {
    it('refuses 3days rather than reading 3', async () => {
        const api = { tasksForDateRange: vi.fn() };
        const out = await createTasksForDateRangeHandler({ api } as any)({ from: 'today', to: 'today', limit: '3days' });
        expect(errorOf(out)).toBe('limit must be a whole number or "all", got: "3days"');
        expect(api.tasksForDateRange).not.toHaveBeenCalled();
    });
});
