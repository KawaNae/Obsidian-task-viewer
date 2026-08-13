import { describe, expect, it, beforeEach } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { IDLE_TIMER_ID, type TimerContext } from '../../../src/timer/TimerContext';
import type { CountupTimer, TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';

/**
 * idle タイマー（次タスク提案）は「走行中のタイマーが 1 本も無い」ときに出る。
 * **中断中は非稼働**として数える — 中断はユーザーが手を止めた合図なので、
 * 中断したまま提案が出ないのは片手落ちになる。
 */

(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1,
    clearInterval: () => { /* unused */ },
};

function build() {
    const ctx = {
        timers: new Map<string, TimerInstance>(),
        intervalPrepareBaseElapsed: new Map<string, number>(),
        recorder: {
            recordSessionEnd: async () => { /* unused */ },
            createChildAtStart: async () => undefined,
            startNextSession: async () => undefined,
            discardRunningPlaceholder: async () => { /* unused */ },
        } as unknown as TimerContext['recorder'],
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } } as unknown as TimerContext['plugin'],
        app: {} as TimerContext['app'],
        startTimer: () => { /* unused */ },
        render: () => { /* unused */ },
        renderTimerItem: () => { /* unused */ },
        persistTimersToStorage: () => { /* unused */ },
        onTimerClosed: () => { /* unused */ },
        ensureContainer: () => ({}) as HTMLElement,
        destroyContainer: () => { /* unused */ },
        getPinState: () => 'pinned' as const,
        togglePin: () => { /* unused */ },
        shouldShowPinBadge: () => false,
    };
    const creator = new TimerCreator(ctx, { isAutoManagedTimerTargetId: () => false } as unknown as TimerStorageUtils);
    return { ctx, lifecycle: new TimerLifecycle(ctx, creator) };
}

function addCountup(ctx: TimerContext, id: string, overrides: Partial<CountupTimer> = {}): CountupTimer {
    const timer: CountupTimer = {
        id,
        taskId: `tv-inline:notes/${id}.md:ln:3`,
        taskName: id,
        taskOriginalText: '- [ ] x',
        taskFile: `notes/${id}.md`,
        startTimeMs: Date.now() - 60_000,
        pausedElapsedTime: 0,
        phase: 'work',
        isRunning: true,
        runState: 'running',
        sessionCount: 0,
        recordedElapsedTime: 0,
        isExpanded: true,
        intervalId: null,
        customLabel: '',
        recordMode: 'child',
        parserId: 'tv-inline',
        taskColor: '',
        timerType: 'countup',
        elapsedTime: 60,
        ...overrides,
    };
    ctx.timers.set(id, timer);
    return timer;
}

describe('idle wake', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); });

    it('wakes when the only timer is suspended', async () => {
        const timer = addCountup(h.ctx, 'timer-1');
        await h.lifecycle.suspendTimer(timer);
        expect(h.ctx.timers.has(IDLE_TIMER_ID)).toBe(true);
    });

    it('stays away while another timer is still running', async () => {
        const a = addCountup(h.ctx, 'timer-1');
        addCountup(h.ctx, 'timer-2');
        await h.lifecycle.suspendTimer(a);
        expect(h.ctx.timers.has(IDLE_TIMER_ID)).toBe(false);
    });

    it('wakes on close even though a suspended timer is still open', () => {
        // 中断中は非稼働なので、走行中が消えた時点で提案は出る。
        addCountup(h.ctx, 'timer-1', { runState: 'suspended', isRunning: false });
        const running = addCountup(h.ctx, 'timer-2');
        h.lifecycle.closeTimer(running.id);
        expect(h.ctx.timers.has(IDLE_TIMER_ID)).toBe(true);
        expect(h.ctx.timers.has('timer-1')).toBe(true);
    });

    it('counts a suspended timer as not running', () => {
        addCountup(h.ctx, 'timer-1', { runState: 'suspended', isRunning: false });
        expect(h.lifecycle.hasNonIdleTimers()).toBe(true);
        expect(h.lifecycle.hasRunningNonIdleTimers()).toBe(false);
    });

    it('leaves the idle timer alone when it is already up', async () => {
        const timer = addCountup(h.ctx, 'timer-1');
        h.lifecycle.startIdleTimer();
        const before = h.ctx.timers.get(IDLE_TIMER_ID);
        await h.lifecycle.suspendTimer(timer);
        expect(h.ctx.timers.get(IDLE_TIMER_ID)).toBe(before);
    });

    it('sends the idle timer away when a suspended session resumes', async () => {
        const timer = addCountup(h.ctx, 'timer-1');
        await h.lifecycle.suspendTimer(timer);
        expect(h.ctx.timers.has(IDLE_TIMER_ID)).toBe(true);

        h.lifecycle.resumeSession(timer);
        expect(h.ctx.timers.has(IDLE_TIMER_ID)).toBe(false);
    });
});
