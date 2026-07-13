import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findOldestOverdueDate } from '../../../../src/services/display/OverdueTaskFinder';
import type { DisplayTask, Task } from '../../../../src/types';
import { DEFAULT_STATUS_DEFINITIONS } from '../../../../src/types';
import type { TaskReadService } from '../../../../src/services/data/TaskReadService';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'tv-inline:test.md:ln:1',
        file: 'test.md',
        line: 0,
        content: 'test task',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        tags: [],
        originalText: '- [ ] test task',
        parserId: 'tv-inline',
        ...overrides,
    };
}

function makeDisplayTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return {
        ...makeTask(),
        effectiveStartDate: '',
        startDateImplicit: true,
        startTimeImplicit: true,
        endDateImplicit: true,
        endTimeImplicit: true,
        originalTaskId: 'tv-inline:test.md:ln:1',
        isSplit: false,
        childEntries: [],
        ...overrides,
    };
}

const defs = DEFAULT_STATUS_DEFINITIONS;
const startHour = 5;

const mockReadService = {
    getTask: vi.fn(),
} as unknown as TaskReadService;

describe('findOldestOverdueDate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 6, 13, 10, 0)); // 2026-07-13 10:00
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null when no tasks', () => {
        expect(findOldestOverdueDate([], startHour, defs, mockReadService)).toBe(null);
    });

    it('returns null when all tasks are completed', () => {
        const tasks = [makeDisplayTask({
            statusChar: 'x',
            effectiveStartDate: '2026-07-01',
            effectiveEndDate: '2026-07-01',
            effectiveEndTime: '10:00',
        })];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe(null);
    });

    it('multiday task still in progress (end in future) is not overdue', () => {
        const tasks = [makeDisplayTask({
            statusChar: ' ',
            effectiveStartDate: '2026-07-10',
            effectiveStartTime: '08:00',
            effectiveEndDate: '2026-07-20',
            effectiveEndTime: '18:00',
        })];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe(null);
    });

    it('returns the visual start date, not the calendar date (early-morning task)', () => {
        // 02:21 start is before startHour(5), so the task renders on the
        // previous visual day. The returned date must match that column,
        // otherwise the "Today" jump lands one day past the task.
        const tasks = [makeDisplayTask({
            statusChar: ' ',
            effectiveStartDate: '2026-02-22',
            effectiveStartTime: '02:21',
            effectiveEndDate: '2026-02-22',
            effectiveEndTime: '03:21',
        })];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe('2026-02-21');
    });

    it('returns the oldest visual start among multiple overdue tasks', () => {
        const tasks = [
            makeDisplayTask({
                id: 'a',
                statusChar: ' ',
                effectiveStartDate: '2026-07-01',
                effectiveStartTime: '10:00',
                effectiveEndDate: '2026-07-01',
                effectiveEndTime: '11:00',
            }),
            makeDisplayTask({
                id: 'b',
                statusChar: ' ',
                effectiveStartDate: '2026-06-15',
                effectiveStartTime: '10:00',
                effectiveEndDate: '2026-06-15',
                effectiveEndTime: '11:00',
            }),
        ];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe('2026-06-15');
    });

    it('parent complete but child unchecked counts as overdue', () => {
        const tasks = [makeDisplayTask({
            statusChar: 'x',
            effectiveStartDate: '2026-07-01',
            effectiveStartTime: '10:00',
            effectiveEndDate: '2026-07-01',
            effectiveEndTime: '11:00',
            childEntries: [
                { kind: 'line', line: { checkboxChar: ' ', bodyLine: 'child', indent: 0 } },
            ],
        })];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe('2026-07-01');
    });
});
