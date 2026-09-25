import { describe, it, expect, vi } from 'vitest';
import { refreshTimerTask } from '../../../src/timer/TimerTaskSync';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * Re-pointing a timer at its task once the name it holds went stale.
 *
 * Names do not survive a restart, so a restored timer holds one that names
 * nothing. The widget finds the row again by the target's anchor and writes
 * the answer back; the direct lookup stays first because the anchor's lookup
 * walks every task.
 */

const STALE = 'tv-inline:a.md:seq:7';
const LIVE = 'tv-inline:a.md:seq:42';

function timer() {
    return { taskId: STALE, taskFile: 'a.md', timerTargetId: 'tv-t-1' };
}

function index(tasks: Task[]) {
    return {
        getTask: (id: string) => tasks.find(task => task.id === id),
        getTaskByAnchor: vi.fn((file: string, anchor: string) => tasks.find(task => task.file === file && task.anchor === anchor)),
    };
}

describe('refreshTimerTask', () => {
    it('leaves the timer alone when its name still names the anchored row, without the anchor lookup', () => {
        const t = timer();
        const task = makeTask({ id: STALE, file: 'a.md', anchor: 'tv-t-1' });
        const idx = index([task]);

        expect(refreshTimerTask(t, idx)).toEqual({ task, rewritten: false });
        expect(t.taskId).toBe(STALE);
        expect(idx.getTaskByAnchor).not.toHaveBeenCalled();
    });

    it('writes the anchored row back when the name is stale', () => {
        const t = timer();
        const task = makeTask({ id: LIVE, file: 'a.md', anchor: 'tv-t-1' });

        expect(refreshTimerTask(t, index([task]))).toEqual({ task, rewritten: true });
        expect(t.taskId).toBe(LIVE);
    });

    it('does not take a row whose ^id another row carries too (no anchor)', () => {
        const t = timer();
        const task = makeTask({ id: LIVE, file: 'a.md', blockId: 'tv-t-1', anchor: undefined });

        expect(refreshTimerTask(t, index([task]))).toEqual({ task: undefined, rewritten: false });
        expect(t.taskId).toBe(STALE);
    });

    it('reports nothing and changes nothing when nothing finds the task', () => {
        const t = timer();

        expect(refreshTimerTask(t, index([]))).toEqual({ task: undefined, rewritten: false });
        expect(t.taskId).toBe(STALE);
    });
});
