import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTaskCompleted, getOverdueLevel } from '../../../../src/services/display/TaskStatusQuery';
import type { DisplayTask, Task, StatusDefinition } from '../../../../src/types';
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
    const base = {
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
    if (base.due && !('effectiveDue' in overrides)) {
        (base as any).effectiveDue = base.due;
    }
    return base;
}

const defs = DEFAULT_STATUS_DEFINITIONS;

const mockReadService = {
    getTask: vi.fn(),
} as unknown as TaskReadService;

describe('isTaskCompleted', () => {
    it('statusChar=x → true', () => {
        const dt = makeDisplayTask({ statusChar: 'x' });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(true);
    });

    it('statusChar=space → false', () => {
        const dt = makeDisplayTask({ statusChar: ' ' });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(false);
    });

    it('statusChar=- (cancelled) → true', () => {
        const dt = makeDisplayTask({ statusChar: '-' });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(true);
    });

    it('statusChar=/ (doing) → false', () => {
        const dt = makeDisplayTask({ statusChar: '/' });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(false);
    });

    it('parent complete + all child lines complete → true', () => {
        const dt = makeDisplayTask({
            statusChar: 'x',
            childEntries: [
                { kind: 'line', line: { checkboxChar: 'x', bodyLine: 'child1', indent: 0 } },
                { kind: 'line', line: { checkboxChar: 'x', bodyLine: 'child2', indent: 0 } },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(true);
    });

    it('parent complete + one child line incomplete → false', () => {
        const dt = makeDisplayTask({
            statusChar: 'x',
            childEntries: [
                { kind: 'line', line: { checkboxChar: 'x', bodyLine: 'child1', indent: 0 } },
                { kind: 'line', line: { checkboxChar: ' ', bodyLine: 'child2', indent: 0 } },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(false);
    });

    it('parent incomplete → false regardless of children', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            childEntries: [
                { kind: 'line', line: { checkboxChar: 'x', bodyLine: 'child1', indent: 0 } },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(false);
    });

    it('parent complete + child task complete → true', () => {
        const childTask = makeTask({ id: 'child-1', statusChar: 'x' });
        vi.mocked(mockReadService.getTask).mockReturnValue(childTask);
        const dt = makeDisplayTask({
            statusChar: 'x',
            childEntries: [
                { kind: 'task', taskId: 'child-1' },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(true);
    });

    it('parent complete + child task incomplete → false', () => {
        const childTask = makeTask({ id: 'child-1', statusChar: ' ' });
        vi.mocked(mockReadService.getTask).mockReturnValue(childTask);
        const dt = makeDisplayTask({
            statusChar: 'x',
            childEntries: [
                { kind: 'task', taskId: 'child-1' },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(false);
    });

    it('non-checkbox child lines are ignored', () => {
        const dt = makeDisplayTask({
            statusChar: 'x',
            childEntries: [
                { kind: 'line', line: { checkboxChar: null, bodyLine: 'plain text', indent: 0 } },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(true);
    });
});

describe('getOverdueLevel', () => {
    const startHour = 5;
    const NOW = new Date(2026, 6, 13, 10, 0); // 2026-07-13 10:00

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.mocked(mockReadService.getTask).mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('completed task → none', () => {
        const dt = makeDisplayTask({ statusChar: 'x', due: '2026-07-01' });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('none');
    });

    it('due in the past → past-due', () => {
        const dt = makeDisplayTask({ statusChar: ' ', due: '2026-07-12' });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-due');
    });

    it('due in the future → none', () => {
        const dt = makeDisplayTask({ statusChar: ' ', due: '2026-07-14' });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('none');
    });

    it('due today → none', () => {
        const dt = makeDisplayTask({ statusChar: ' ', due: '2026-07-13' });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('none');
    });

    it('effectiveEndDate in the past, no due → past-end', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            effectiveEndDate: '2026-07-12',
            effectiveEndTime: '18:00',
        });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-end');
    });

    it('effectiveEndDate in the future, no due → none', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            effectiveEndDate: '2026-07-15',
            effectiveEndTime: '18:00',
        });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('none');
    });

    it('both due and end past → past-due (higher severity wins)', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            due: '2026-07-10',
            effectiveEndDate: '2026-07-08',
            effectiveEndTime: '18:00',
        });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-due');
    });

    it('end past but due still in future → past-end', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            due: '2026-07-15',
            effectiveEndDate: '2026-07-12',
            effectiveEndTime: '18:00',
        });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-end');
    });

    it('start>end>due example: @7-11>7-13>7-15, now=7-14 → past-end', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            startDate: '2026-07-11',
            effectiveStartDate: '2026-07-11',
            effectiveStartTime: '05:00',
            effectiveEndDate: '2026-07-13',
            effectiveEndTime: '04:59',
            due: '2026-07-15',
        });
        vi.setSystemTime(new Date(2026, 6, 14, 10, 0));
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-end');
    });

    it('start>end>due example: @7-11>7-13>7-15, now=7-16 → past-due', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            startDate: '2026-07-11',
            effectiveStartDate: '2026-07-11',
            effectiveStartTime: '05:00',
            effectiveEndDate: '2026-07-13',
            effectiveEndTime: '04:59',
            due: '2026-07-15',
        });
        vi.setSystemTime(new Date(2026, 6, 16, 10, 0));
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-due');
    });

    it('start>end example: @7-11>7-13, now=7-14 → past-end', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            startDate: '2026-07-11',
            effectiveStartDate: '2026-07-11',
            effectiveStartTime: '05:00',
            effectiveEndDate: '2026-07-13',
            effectiveEndTime: '04:59',
        });
        vi.setSystemTime(new Date(2026, 6, 14, 10, 0));
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-end');
    });

    it('start only example: @7-11, now=7-12 → past-end (implicit end)', () => {
        const dt = makeDisplayTask({
            statusChar: ' ',
            startDate: '2026-07-11',
            effectiveStartDate: '2026-07-11',
            effectiveStartTime: '05:00',
            effectiveEndDate: '2026-07-11',
            effectiveEndTime: '04:59',
        });
        vi.setSystemTime(new Date(2026, 6, 12, 10, 0));
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-end');
    });

    it('no dates at all → none', () => {
        const dt = makeDisplayTask({ statusChar: ' ' });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('none');
    });

    it('child incomplete makes parent not completed → overdue possible', () => {
        const childTask = makeTask({ id: 'child-1', statusChar: ' ' });
        vi.mocked(mockReadService.getTask).mockReturnValue(childTask);
        const dt = makeDisplayTask({
            statusChar: 'x',
            due: '2026-07-10',
            childEntries: [{ kind: 'task', taskId: 'child-1' }],
        });
        expect(getOverdueLevel(dt, startHour, defs, mockReadService)).toBe('past-due');
    });
});
