import { describe, it, expect, vi } from 'vitest';
import { refreshTimerTask } from '../../../src/timer/TimerTaskSync';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * Re-pointing a timer at its task once the ID it holds went stale.
 *
 * Runtime IDs do not survive a restart, so a restored timer holds an ID that
 * names nothing. The widget re-resolves on its tick and writes the answer back;
 * the direct lookup has to stay first because the resolver walks every task.
 */

const STALE = 'tv-inline:a.md:seq:7';
const LIVE = 'tv-inline:a.md:seq:42';

function timer() {
    return {
        taskId: STALE,
        taskFile: 'a.md',
        taskOriginalText: '- [ ] A',
        timerTargetId: 'tv-t-1',
        parserId: 'tv-inline' as const,
    };
}

function index(tasks: Task[]) {
    return { getTask: (id: string) => tasks.find(task => task.id === id) };
}

describe('refreshTimerTask', () => {
    it('leaves the timer alone when its ID still resolves, without asking the resolver', () => {
        const t = timer();
        const task = makeTask({ id: STALE, file: 'a.md' });
        const resolver = { resolveTvInline: vi.fn(), resolveTvFile: vi.fn() };

        const result = refreshTimerTask(t, index([task]), resolver);

        expect(result).toEqual({ task, rewritten: false });
        expect(t.taskId).toBe(STALE);
        expect(resolver.resolveTvInline).not.toHaveBeenCalled();
    });

    it('writes the resolved task back when the ID is stale', () => {
        const t = timer();
        const task = makeTask({ id: LIVE, file: 'dir/a.md' });
        const resolver = { resolveTvInline: vi.fn(() => task), resolveTvFile: vi.fn() };

        const result = refreshTimerTask(t, index([task]), resolver);

        expect(result).toEqual({ task, rewritten: true });
        expect(t.taskId).toBe(LIVE);
        expect(t.taskFile).toBe('dir/a.md');
    });

    it('asks the tv-file resolver for a tv-file timer', () => {
        const t = { ...timer(), taskId: 'tv-file:p.md:fm-root', parserId: 'tv-file' as const };
        const resolver = { resolveTvInline: vi.fn(), resolveTvFile: vi.fn(() => undefined) };

        refreshTimerTask(t, index([]), resolver);

        expect(resolver.resolveTvFile).toHaveBeenCalled();
        expect(resolver.resolveTvInline).not.toHaveBeenCalled();
    });

    it('reports nothing and changes nothing when neither finds the task', () => {
        const t = timer();
        const resolver = { resolveTvInline: vi.fn(() => undefined), resolveTvFile: vi.fn() };

        const result = refreshTimerTask(t, index([]), resolver);

        expect(result).toEqual({ task: undefined, rewritten: false });
        expect(t.taskId).toBe(STALE);
    });
});
