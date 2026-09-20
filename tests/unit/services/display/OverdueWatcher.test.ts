import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OverdueWatcher } from '../../../../src/services/display/OverdueWatcher';
import type { DisplayTask } from '../../../../src/types';
import { DEFAULT_STATUS_DEFINITIONS } from '../../../../src/types';
import type { TaskReadService } from '../../../../src/services/data/TaskReadService';

const defs = DEFAULT_STATUS_DEFINITIONS;
const startHour = 5;

const readService = {
    getTask: vi.fn(() => undefined),
    getDisplayTask: vi.fn(() => undefined),
} as unknown as TaskReadService;

/** A timed task ending on 2026-07-13 at `endTime`, incomplete unless said otherwise. */
function makeTask(id: string, endTime: string, overrides: Partial<DisplayTask> = {}): DisplayTask {
    return {
        id,
        file: 'test.md',
        line: 0,
        content: id,
        statusChar: ' ',
        parserId: 'tv-inline',
        indent: 0,
        childIds: [],
        childLines: [],
        tags: [],
        originalText: `- [ ] ${id}`,
        isReadOnly: false,
        effectiveStartDate: '2026-07-13',
        effectiveStartTime: '09:00',
        effectiveEndDate: '2026-07-13',
        effectiveEndTime: endTime,
        startDateImplicit: false,
        startTimeImplicit: false,
        endDateImplicit: false,
        endTimeImplicit: false,
        originalTaskId: id,
        isSplit: false,
        childEntries: [],
        ...overrides,
    } as DisplayTask;
}

function sweep(watcher: OverdueWatcher, tasks: DisplayTask[]): boolean {
    return watcher.sweep(tasks, startHour, defs, readService);
}

describe('OverdueWatcher', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 6, 13, 10, 0)); // 2026-07-13 10:00
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not report the first sweep, so load does not redraw every view', () => {
        const watcher = new OverdueWatcher();
        // Already overdue at the first sweep — still not a change, because
        // nothing was known about it before.
        expect(sweep(watcher, [makeTask('a', '09:30')])).toBe(false);
    });

    it('reports nothing while the clock stays on the same side of the end', () => {
        const watcher = new OverdueWatcher();
        const tasks = [makeTask('a', '10:30')];

        sweep(watcher, tasks);
        vi.setSystemTime(new Date(2026, 6, 13, 10, 20));

        expect(sweep(watcher, tasks)).toBe(false);
    });

    it('reports the sweep on which a task crosses its end', () => {
        const watcher = new OverdueWatcher();
        const tasks = [makeTask('a', '10:30')];

        sweep(watcher, tasks);
        vi.setSystemTime(new Date(2026, 6, 13, 10, 31));

        expect(sweep(watcher, tasks)).toBe(true);
    });

    it('reports the crossing once, not on every later sweep', () => {
        const watcher = new OverdueWatcher();
        const tasks = [makeTask('a', '10:30')];

        sweep(watcher, tasks);
        vi.setSystemTime(new Date(2026, 6, 13, 10, 31));
        expect(sweep(watcher, tasks)).toBe(true);

        vi.setSystemTime(new Date(2026, 6, 13, 10, 32));
        expect(sweep(watcher, tasks)).toBe(false);
    });

    it('catches up in one sweep after a long gap, so a slept-through tick is not lost', () => {
        const watcher = new OverdueWatcher();
        const tasks = [makeTask('a', '10:30'), makeTask('b', '11:30')];

        sweep(watcher, tasks);
        // Both ends went by while nothing swept.
        vi.setSystemTime(new Date(2026, 6, 13, 14, 0));

        expect(sweep(watcher, tasks)).toBe(true);
    });

    it('stays quiet when a task stops being overdue, since an edit did that', () => {
        const watcher = new OverdueWatcher();
        sweep(watcher, [makeTask('a', '09:30')]);

        // Completing it is an index change, which has already told the views.
        expect(sweep(watcher, [makeTask('a', '09:30', { statusChar: 'x' })])).toBe(false);
    });

    it('reports a task that goes from past its end to past its due', () => {
        const watcher = new OverdueWatcher();
        // End at 09:30 (already gone), due later the same day.
        const withDue = (id: string) => makeTask(id, '09:30', { effectiveDue: '2026-07-13T11:00' });

        sweep(watcher, [withDue('a')]);
        vi.setSystemTime(new Date(2026, 6, 13, 11, 1));

        expect(sweep(watcher, [withDue('a')])).toBe(true);
    });

    it('does not report a task that only just appeared', () => {
        const watcher = new OverdueWatcher();
        sweep(watcher, [makeTask('a', '10:30')]);

        // 'b' is already past its end, but it was never seen before.
        expect(sweep(watcher, [makeTask('a', '10:30'), makeTask('b', '09:30')])).toBe(false);
    });

    it('forgets a task that has gone, so its id cannot report on its return', () => {
        const watcher = new OverdueWatcher();
        // 'a' never crosses within the test, so only 'b' can report.
        const a = makeTask('a', '11:30');
        const b = makeTask('b', '10:30');
        sweep(watcher, [a, b]);

        // 'b' leaves while still not overdue, and comes back after its end.
        sweep(watcher, [a]);
        vi.setSystemTime(new Date(2026, 6, 13, 10, 31));

        // Its return is an index change, which has already told the views.
        expect(sweep(watcher, [a, b])).toBe(false);
    });

    it('re-seeds after reset', () => {
        const watcher = new OverdueWatcher();
        const tasks = [makeTask('a', '10:30')];
        sweep(watcher, tasks);

        watcher.reset();
        vi.setSystemTime(new Date(2026, 6, 13, 10, 31));

        expect(sweep(watcher, tasks)).toBe(false);
    });
});
