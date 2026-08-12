import { describe, expect, it, beforeEach } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { IDLE_TIMER_ID, type TimerContext } from '../../../src/timer/TimerContext';
import type { CountdownTimer, CountupTimer, TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';

/**
 * 4 出口のうち、状態機械に乗る 3 つ（⏸ 中断 / ▶ 再開 / ✓ 完了）の遷移。
 * 書き込みの種類は変えないので、記録は既存の recordSessionEnd に委ねている
 * — ここで見るのは「いつ呼ばれるか」と「呼んだ後の状態」。
 */

const intervals: number[] = [];
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => { intervals.push(intervals.length + 1); return intervals.length; },
    clearInterval: (id: number) => { const i = intervals.indexOf(id); if (i >= 0) intervals.splice(i, 1); },
};

interface RecorderCalls {
    recordSessionEnd: number;
    completeTargetTask: number;
    createChildAtStart: number;
    startNextSession: number;
    order: string[];
}

function build() {
    const calls: RecorderCalls = { recordSessionEnd: 0, completeTargetTask: 0, createChildAtStart: 0, startNextSession: 0, order: [] };
    const recorder = {
        recordSessionEnd: async () => { calls.recordSessionEnd++; calls.order.push('record'); },
        completeTargetTask: async () => { calls.completeTargetTask++; calls.order.push('complete'); },
        createChildAtStart: async () => { calls.createChildAtStart++; calls.order.push('placeholder'); return 'tv-inline:notes/a.md:ln:4'; },
        startNextSession: async () => { calls.startNextSession++; calls.order.push('nextSession'); return 'tv-inline:notes/a.md:ln:4'; },
        syncGroupDateSpan: async () => { calls.order.push('groupDate'); },
    };

    let persisted = 0;
    const ctx = {
        timers: new Map<string, TimerInstance>(),
        intervalPrepareBaseElapsed: new Map<string, number>(),
        recorder: recorder as unknown as TimerContext['recorder'],
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } } as unknown as TimerContext['plugin'],
        app: {} as TimerContext['app'],
        startTimer: () => { /* unused */ },
        render: () => { /* unused */ },
        renderTimerItem: () => { /* unused */ },
        persistTimersToStorage: () => { persisted++; },
        onTimerClosed: () => { /* unused */ },
        ensureContainer: () => ({}) as HTMLElement,
        destroyContainer: () => { /* unused */ },
        getPinState: () => 'pinned' as const,
        togglePin: () => { /* unused */ },
        shouldShowPinBadge: () => false,
    };

    const creator = new TimerCreator(ctx, { isAutoManagedTimerTargetId: () => false } as unknown as TimerStorageUtils);
    const lifecycle = new TimerLifecycle(ctx, creator);
    return { ctx, lifecycle, calls, persistedCount: () => persisted };
}

function startCountup(ctx: TimerContext, overrides: Partial<CountupTimer> = {}): CountupTimer {
    const timer: CountupTimer = {
        id: 'timer-1',
        taskId: 'tv-inline:notes/a.md:ln:3',
        taskName: 'A',
        taskOriginalText: '- [ ] A',
        taskFile: 'notes/a.md',
        startTimeMs: Date.now() - 600_000, // 10 分走った
        pausedElapsedTime: 0,
        phase: 'work',
        isRunning: true,
        runState: 'running',
        sessionCount: 0,
        recordedElapsedTime: 0,
        isExpanded: true,
        intervalId: null,
        customLabel: '',
        recordMode: 'self',
        parserId: 'tv-inline',
        taskColor: '',
        timerType: 'countup',
        elapsedTime: 600,
        recordedChildTaskId: 'tv-inline:notes/a.md:ln:4',
        ...overrides,
    };
    ctx.timers.set(timer.id, timer);
    return timer;
}

describe('suspend', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); intervals.length = 0; });

    it('records the session and keeps the widget alive', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.suspendTimer(timer);

        expect(h.calls.recordSessionEnd).toBe(1);
        expect(h.ctx.timers.has(timer.id)).toBe(true);
        expect(timer.runState).toBe('suspended');
        expect(timer.isRunning).toBe(false);          // 不変条件: suspended ⇒ ticker 停止
        expect(timer.sessionCount).toBe(1);
        expect(timer.recordedElapsedTime).toBeGreaterThanOrEqual(600);
        expect(timer.isExpanded).toBe(false);         // 自動折りたたみ
    });

    it('releases the placeholder and drops to child mode for later sessions', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.suspendTimer(timer);

        expect(timer.recordedChildTaskId).toBeUndefined();
        expect(timer.recordMode).toBe('child');
    });

    it('is a no-op for a timer that is already suspended', async () => {
        const timer = startCountup(h.ctx, { runState: 'suspended', isRunning: false });
        await h.lifecycle.suspendTimer(timer);
        expect(h.calls.recordSessionEnd).toBe(0);
    });

    it('does not touch interval timers (they keep the current pause/stop model)', async () => {
        const timer = startCountup(h.ctx) as unknown as TimerInstance;
        (timer as unknown as { timerType: string }).timerType = 'interval';
        await h.lifecycle.suspendTimer(timer);
        expect(h.calls.recordSessionEnd).toBe(0);
        expect(timer.runState).toBe('running');
    });
});

describe('resume', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); intervals.length = 0; });

    it('starts a fresh session instead of carrying the previous elapsed time', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.suspendTimer(timer);
        const totalAfterFirst = timer.recordedElapsedTime;

        h.lifecycle.resumeSession(timer);

        expect(timer.runState).toBe('running');
        expect(timer.isRunning).toBe(true);
        expect(timer.pausedElapsedTime).toBe(0);
        expect(timer.elapsedTime).toBe(0);
        expect(timer.recordedElapsedTime).toBe(totalAfterFirst); // 合計は保持
        expect(timer.isExpanded).toBe(true);
        expect(intervals).toHaveLength(1);                        // ticker 再開
    });

    it('writes the new session line at start', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.suspendTimer(timer);
        h.lifecycle.resumeSession(timer);
        await Promise.resolve();
        await Promise.resolve();

        // 書き先（変形 or 追記）の判断は recorder 側。ここでは「開始時に 1 本
        // セッション行を書く」ことだけを見る。
        expect(h.calls.startNextSession).toBe(1);
        expect(timer.recordedChildTaskId).toBe('tv-inline:notes/a.md:ln:4');
    });

    it('restarts a countdown from a full clock', async () => {
        const countdown = startCountup(h.ctx) as unknown as CountdownTimer;
        (countdown as unknown as { timerType: string }).timerType = 'countdown';
        countdown.totalTime = 1500;
        countdown.timeRemaining = 300;
        await h.lifecycle.suspendTimer(countdown as unknown as TimerInstance);

        h.lifecycle.resumeSession(countdown as unknown as TimerInstance);

        expect(countdown.timeRemaining).toBe(1500);
        expect(countdown.elapsedTime).toBe(0);
        expect(countdown.phase).toBe('work');
    });

    it('is a no-op for a running timer', () => {
        const timer = startCountup(h.ctx);
        h.lifecycle.resumeSession(timer);
        expect(h.calls.startNextSession).toBe(0);
    });
});

describe('complete', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); intervals.length = 0; });

    it('records the running session, completes the task, then closes', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.completeTimer(timer);

        // 記録 → グループ帯の更新 → 完了 の順（グループ未形成なら更新は no-op）
        expect(h.calls.order).toEqual(['record', 'groupDate', 'complete']);
        expect(timer.sessionCount).toBe(1);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });

    it('does not record again when the timer was already suspended', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.suspendTimer(timer);
        h.calls.order.length = 0;

        await h.lifecycle.completeTimer(timer);

        expect(h.calls.order).toEqual(['complete']);
        expect(timer.sessionCount).toBe(1);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });

    it('wakes the idle timer once the last widget is gone', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.completeTimer(timer);
        expect(h.ctx.timers.has(IDLE_TIMER_ID)).toBe(true);
    });
});
