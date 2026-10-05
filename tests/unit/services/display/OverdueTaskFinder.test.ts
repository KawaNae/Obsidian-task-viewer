import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findOldestOverdueDate } from '../../../../src/services/display/OverdueTaskFinder';
import type { DisplayTask, Task } from '../../../../src/types';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../../src/services/display/DisplayTaskConverter';
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

/** A display copy of a task with the given line values (and display fields). */
function makeDisplayTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return { ...toDisplayTask(makeTask(overrides), 5, NO_TASK_LOOKUP), ...overrides };
}

const defs = DEFAULT_STATUS_DEFINITIONS;
const startHour = 5;

const mockReadService = {
    getDisplayTask: vi.fn(),
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
            startDate: '2026-07-01',
            endDate: '2026-07-01',
            endTime: '10:00',
        })];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe(null);
    });

    it('multiday task still in progress (end in future) is not overdue', () => {
        const tasks = [makeDisplayTask({
            statusChar: ' ',
            startDate: '2026-07-10',
            startTime: '08:00',
            endDate: '2026-07-20',
            endTime: '18:00',
        })];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe(null);
    });

    it('returns the visual start date, not the calendar date (early-morning task)', () => {
        // 02:21 start is before startHour(5), so the task renders on the
        // previous visual day. The returned date must match that column,
        // otherwise the "Today" jump lands one day past the task.
        const tasks = [makeDisplayTask({
            statusChar: ' ',
            startDate: '2026-02-22',
            startTime: '02:21',
            endDate: '2026-02-22',
            endTime: '03:21',
        })];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe('2026-02-21');
    });

    it('returns the oldest visual start among multiple overdue tasks', () => {
        const tasks = [
            makeDisplayTask({
                id: 'a',
                statusChar: ' ',
                startDate: '2026-07-01',
                startTime: '10:00',
                endDate: '2026-07-01',
                endTime: '11:00',
            }),
            makeDisplayTask({
                id: 'b',
                statusChar: ' ',
                startDate: '2026-06-15',
                startTime: '10:00',
                endDate: '2026-06-15',
                endTime: '11:00',
            }),
        ];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe('2026-06-15');
    });

    it('parent complete but child unchecked counts as overdue', () => {
        vi.mocked(mockReadService.getDisplayTask).mockReturnValue(makeTask({ id: 'child', statusChar: ' ' }));
        const tasks = [makeDisplayTask({
            statusChar: 'x',
            startDate: '2026-07-01',
            startTime: '10:00',
            endDate: '2026-07-01',
            endTime: '11:00',
            childEntries: [
                { kind: 'task', taskId: 'child', bodyLine: 1 },
            ],
        })];
        expect(findOldestOverdueDate(tasks, startHour, defs, mockReadService)).toBe('2026-07-01');
    });
});
