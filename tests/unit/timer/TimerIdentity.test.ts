import { describe, expect, it, beforeEach } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { IDLE_TIMER_ID, type TimerContext } from '../../../src/timer/TimerContext';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';

/**
 * タイマーの同一性は **タスクから独立**していなければならない。
 * `handleFileRename` は `timer.taskId` をその場で書き換えるので、タスク id を
 * キーにしていると Map / DOM / ticker が取り残される（rename 後に同じタスクで
 * 二重起動できてしまうのが実害）。
 */

// TimerLifecycle は ticker に window タイマーを使う。node environment なので最小スタブ。
const timerHandles: number[] = [];
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => {
        const id = timerHandles.length + 1;
        timerHandles.push(id);
        return id;
    },
    clearInterval: (id: number) => {
        const idx = timerHandles.indexOf(id);
        if (idx >= 0) timerHandles.splice(idx, 1);
    },
};

function makeCtx(): TimerContext & { renders: number } {
    const ctx = {
        timers: new Map<string, TimerInstance>(),
        recorder: {} as TimerContext['recorder'],
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } } as unknown as TimerContext['plugin'],
        app: {} as TimerContext['app'],
        renders: 0,
        startTimer: () => { /* unused */ },
        render() { ctx.renders++; },
        renderTimerItem: () => { /* unused */ },
        persistTimersToStorage: () => { /* unused */ },
        onTimerClosed: () => { /* unused */ },
        flushTimerContent: async () => { /* unused */ },
        discardTimerContent: () => { /* unused */ },
        ensureContainer: () => ({}) as HTMLElement,
        destroyContainer: () => { /* unused */ },
        getPinState: () => 'pinned' as const,
        togglePin: () => { /* unused */ },
        shouldShowPinBadge: () => false,
    };
    return ctx;
}

const storageUtils = {
    isAutoManagedTimerTargetId: () => false,
} as unknown as TimerStorageUtils;

const TASK_ID = 'tv-inline:notes/a.md:ln:3';
const RENAMED_TASK_ID = 'tv-inline:notes/renamed.md:ln:3';

describe('timer identity', () => {
    let ctx: ReturnType<typeof makeCtx>;
    let creator: TimerCreator;
    let lifecycle: TimerLifecycle;

    beforeEach(() => {
        ctx = makeCtx();
        creator = new TimerCreator(ctx, storageUtils);
        lifecycle = new TimerLifecycle(ctx, creator);
    });

    function start(taskId: string): TimerInstance {
        const timer = creator.createTimer({ taskId, taskName: 'A', timerType: 'countup', autoStart: true });
        ctx.timers.set(timer.id, timer);
        return timer;
    }

    it('gives every timer an id that is not the task id', () => {
        const timer = start(TASK_ID);
        expect(timer.id).not.toBe(TASK_ID);
        expect(timer.id.startsWith('timer-')).toBe(true);
    });

    it('gives two timers on the same task distinct ids', () => {
        const a = creator.createTimer({ taskId: TASK_ID, taskName: 'A', timerType: 'countup' });
        const b = creator.createTimer({ taskId: TASK_ID, taskName: 'A', timerType: 'countup' });
        expect(a.id).not.toBe(b.id);
    });

    it('keeps the idle sentinel id (single-instance guard depends on it)', () => {
        const idle = creator.createTimer({ taskId: 'ignored', taskName: '', timerType: 'idle' });
        expect(idle.id).toBe(IDLE_TIMER_ID);
        expect(lifecycle.isIdleTimer(idle.id)).toBe(true);
    });

    it('still finds the active timer after a file rename rewrites taskId', () => {
        const timer = start(TASK_ID);
        expect(lifecycle.hasActiveTimerForTask(TASK_ID)).toBe(true);

        // handleFileRename の挙動: taskId だけをその場で書き換える
        timer.taskId = RENAMED_TASK_ID;

        expect(lifecycle.hasActiveTimerForTask(RENAMED_TASK_ID)).toBe(true);
        expect(lifecycle.hasActiveTimerForTask(TASK_ID)).toBe(false);
    });

    it('closes the timer by its own id after a rename', () => {
        const timer = start(TASK_ID);
        timer.taskId = RENAMED_TASK_ID;

        lifecycle.closeTimer(timer.id);

        expect(ctx.timers.has(timer.id)).toBe(false);
        // 非 idle が居なくなったので idle が起きる
        expect(ctx.timers.has(IDLE_TIMER_ID)).toBe(true);
    });

    it('matches by timerTargetId as before', () => {
        const timer = creator.createTimer({
            taskId: TASK_ID, taskName: 'A', timerType: 'countup', timerTargetId: 'tv-timer-1',
        });
        ctx.timers.set(timer.id, timer);

        expect(lifecycle.hasActiveTimerForTask('tv-inline:other.md:ln:9', 'tv-timer-1')).toBe(true);
        expect(lifecycle.hasActiveTimerForTask('tv-inline:other.md:ln:9', 'tv-timer-2')).toBe(false);
    });

    it('reports the idle timer only through the sentinel', () => {
        expect(lifecycle.hasActiveTimerForTask(IDLE_TIMER_ID)).toBe(false);
        lifecycle.startIdleTimer();
        expect(lifecycle.hasActiveTimerForTask(IDLE_TIMER_ID)).toBe(true);
    });
});
