import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../../src/services/display/DisplayTaskConverter';
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

/** A display copy of a task with the given line values (startHour 5). */
function makeDisplayTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return { ...toDisplayTask(makeTask(overrides), 5, NO_TASK_LOOKUP), ...overrides };
}

const defs = DEFAULT_STATUS_DEFINITIONS;

const mockReadService = {
    getDisplayTask: vi.fn(),
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

    it('parent incomplete → false regardless of children', () => {
        const childTask = makeTask({ id: 'child-1', statusChar: 'x' });
        vi.mocked(mockReadService.getDisplayTask).mockReturnValue(childTask);
        const dt = makeDisplayTask({
            statusChar: ' ',
            childEntries: [
                { kind: 'task', taskId: 'child-1' },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(false);
    });

    it('parent complete + child task complete → true', () => {
        const childTask = makeTask({ id: 'child-1', statusChar: 'x' });
        vi.mocked(mockReadService.getDisplayTask).mockReturnValue(childTask);
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
        vi.mocked(mockReadService.getDisplayTask).mockReturnValue(childTask);
        const dt = makeDisplayTask({
            statusChar: 'x',
            childEntries: [
                { kind: 'task', taskId: 'child-1' },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(false);
    });

    // A child line is never a checkbox; even a `- [ ]` inside a code fence is
    // an example, not an unfinished step.
    it('child lines never count, even one that looks like a checkbox', () => {
        const dt = makeDisplayTask({
            statusChar: 'x',
            childEntries: [
                { kind: 'line', bodyLine: 1, line: { text: '- [ ] fenced example', bodyLine: 1, indent: '', wikilinkTarget: null, propertyKey: null, propertyValue: null } },
            ],
        });
        expect(isTaskCompleted(dt, defs, mockReadService)).toBe(true);
    });
});

describe('getOverdueLevel', () => {
    const NOW = new Date(2026, 6, 13, 10, 0); // 2026-07-13 10:00

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.mocked(mockReadService.getDisplayTask).mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const level = (dt: DisplayTask, svc = mockReadService) => getOverdueLevel(dt, defs, svc);

    it('completed task → none', () => {
        expect(level(makeDisplayTask({ statusChar: 'x', due: '2026-07-01' }))).toBe('none');
    });

    it('due in the past → past-due', () => {
        expect(level(makeDisplayTask({ statusChar: ' ', due: '2026-07-12' }))).toBe('past-due');
    });

    it('due in the future → none', () => {
        expect(level(makeDisplayTask({ statusChar: ' ', due: '2026-07-14' }))).toBe('none');
    });

    it('due today → none', () => {
        expect(level(makeDisplayTask({ statusChar: ' ', due: '2026-07-13' }))).toBe('none');
    });

    it('a bare due D is past-due from the start of D+1 exactly', () => {
        const dt = makeDisplayTask({ statusChar: ' ', due: '2026-07-13' });
        vi.setSystemTime(new Date(2026, 6, 14, 4, 59));
        expect(level(dt)).toBe('none');
        vi.setSystemTime(new Date(2026, 6, 14, 5, 0));
        expect(level(dt)).toBe('past-due');
    });

    it('a timed due is past-due from its minute', () => {
        const dt = makeDisplayTask({ statusChar: ' ', due: '2026-07-13T10:00' });
        expect(level(dt)).toBe('past-due');
    });

    it('end in the past, no due → past-end', () => {
        const dt = makeDisplayTask({ statusChar: ' ', startDate: '2026-07-12', startTime: '17:00', endTime: '18:00' });
        expect(level(dt)).toBe('past-end');
    });

    it('end in the future, no due → none', () => {
        const dt = makeDisplayTask({ statusChar: ' ', startDate: '2026-07-15', startTime: '17:00', endTime: '18:00' });
        expect(level(dt)).toBe('none');
    });

    it('both due and end past → past-due (higher severity wins)', () => {
        const dt = makeDisplayTask({ statusChar: ' ', due: '2026-07-10', startDate: '2026-07-08' });
        expect(level(dt)).toBe('past-due');
    });

    it('end past but due still in future → past-end', () => {
        const dt = makeDisplayTask({ statusChar: ' ', due: '2026-07-15', startDate: '2026-07-12' });
        expect(level(dt)).toBe('past-end');
    });

    it('start>end>due example: @7-11>7-13>7-15, now=7-14 → past-end', () => {
        const dt = makeDisplayTask({ statusChar: ' ', startDate: '2026-07-11', endDate: '2026-07-13', due: '2026-07-15' });
        vi.setSystemTime(new Date(2026, 6, 14, 10, 0));
        expect(level(dt)).toBe('past-end');
    });

    it('start>end>due example: @7-11>7-13>7-15, now=7-16 → past-due', () => {
        const dt = makeDisplayTask({ statusChar: ' ', startDate: '2026-07-11', endDate: '2026-07-13', due: '2026-07-15' });
        vi.setSystemTime(new Date(2026, 6, 16, 10, 0));
        expect(level(dt)).toBe('past-due');
    });

    it('start only example: @7-11, now=7-12 → past-end (implicit end)', () => {
        const dt = makeDisplayTask({ statusChar: ' ', startDate: '2026-07-11' });
        vi.setSystemTime(new Date(2026, 6, 12, 10, 0));
        expect(level(dt)).toBe('past-end');
    });

    it('no dates at all → none', () => {
        expect(level(makeDisplayTask({ statusChar: ' ' }))).toBe('none');
    });

    it('child incomplete makes parent not completed → overdue possible', () => {
        const childTask = makeTask({ id: 'child-1', statusChar: ' ' });
        vi.mocked(mockReadService.getDisplayTask).mockReturnValue(childTask as DisplayTask);
        const dt = makeDisplayTask({
            statusChar: 'x',
            due: '2026-07-10',
            childEntries: [{ kind: 'task', taskId: 'child-1', bodyLine: 1 }],
        });
        expect(level(dt)).toBe('past-due');
    });

    it('a segment holds the span of its line, so what it is drawn over does not count', () => {
        // @2026-07-17>2026-07-20, now=07-18: the segment drawn up to 07-18 05:00 is not late
        const whole = makeDisplayTask({ statusChar: ' ', startDate: '2026-07-17', endDate: '2026-07-20' });
        const segment: DisplayTask = {
            ...whole,
            id: `${whole.id}##seg:2026-07-17`,
            isSplit: true,
            drawn: { startMs: whole.span!.startMs, endMs: new Date(2026, 6, 18, 5, 0).getTime() },
        };
        vi.setSystemTime(new Date(2026, 6, 18, 17, 0));
        expect(level(segment)).toBe('none');
    });
});
