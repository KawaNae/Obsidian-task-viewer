import { describe, expect, it, beforeEach } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { IDLE_TIMER_ID, type TimerContext } from '../../../src/timer/TimerContext';
import type { CountdownTimer, CountupTimer, TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';

/**
 * 4 出口（⏸ 中断 / ▶ 再開 / ■ 終了 / ✕ 破棄）の遷移。
 *
 * 記録の中身は recorder が持つので、ここで見るのは「いつ呼ばれるか」と「呼んだ
 * 後の状態」。v2 で変わったのは 2 点 — 終了が**タスクの状態を触らない**ことと、
 * 中断が尻尾（次の再開の足場）を手放さないこと。
 */

const intervals: number[] = [];
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => { intervals.push(intervals.length + 1); return intervals.length; },
    clearInterval: (id: number) => { const i = intervals.indexOf(id); if (i >= 0) intervals.splice(i, 1); },
};

interface RecorderCalls {
    recordSessionEnd: number;
    createChildAtStart: number;
    startNextSession: number;
    discardRunningPlaceholder: number;
    order: string[];
}

function build() {
    const calls: RecorderCalls = { recordSessionEnd: 0, createChildAtStart: 0, startNextSession: 0, discardRunningPlaceholder: 0, order: [] };
    const recorder = {
        recordSessionEnd: async () => { calls.recordSessionEnd++; calls.order.push('record'); },
        createChildAtStart: async () => { calls.createChildAtStart++; calls.order.push('placeholder'); return 'tv-inline:notes/a.md:ln:4'; },
        startNextSession: async () => { calls.startNextSession++; calls.order.push('nextSession'); return 'tv-inline:notes/a.md:ln:5'; },
        discardRunningPlaceholder: async () => { calls.discardRunningPlaceholder++; calls.order.push('discard'); },
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
        tailRecordBlockId: 'tv-t-abc1234',
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

    it('keeps the tail so the next resume knows what to sit beside', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.suspendTimer(timer);

        // 記録し終えた行がそのまま尻尾。ここを手放すと再開が置き場を失う。
        expect(timer.tailRecordBlockId).toBe('tv-t-abc1234');
        expect(timer.recordedChildTaskId).toBe('tv-inline:notes/a.md:ln:4');
        // recordMode は 1 本目の書き方であって、中断で書き換わるものではない。
        expect(timer.recordMode).toBe('self');
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

        // 書き先（尻尾の兄弟 / フォールバックの子）の判断は recorder 側。ここでは
        // 「開始時に 1 本セッション行を書く」ことだけを見る。
        expect(h.calls.startNextSession).toBe(1);
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

describe('finish', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); intervals.length = 0; });

    it('records the running session and closes, without touching the task state', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.finishTimer(timer);

        // 記録して閉じるだけ。完了は checkbox でユーザーが宣言するものなので、
        // v1 の completeTargetTask に当たる書き込みはもう存在しない。
        expect(h.calls.order).toEqual(['record']);
        expect(timer.sessionCount).toBe(1);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });

    it('does not record again when the timer was already suspended', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.suspendTimer(timer);
        h.calls.order.length = 0;

        await h.lifecycle.finishTimer(timer);

        expect(h.calls.order).toEqual([]);
        expect(timer.sessionCount).toBe(1);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });

    it('wakes the idle timer once the last widget is gone', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.finishTimer(timer);
        expect(h.ctx.timers.has(IDLE_TIMER_ID)).toBe(true);
    });
});

describe('discard', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); intervals.length = 0; });

    it('drops the running session without recording it, and cleans up its line', async () => {
        const timer = startCountup(h.ctx);
        await h.lifecycle.discardTimer(timer);

        expect(h.calls.order).toEqual(['discard']);
        expect(h.calls.recordSessionEnd).toBe(0);
        expect(timer.sessionCount).toBe(0);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });
});

describe('the session cycle', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); intervals.length = 0; });

    it('records once per session across suspend → resume → finish', async () => {
        const timer = startCountup(h.ctx);

        await h.lifecycle.suspendTimer(timer);
        h.lifecycle.resumeSession(timer);
        await Promise.resolve();
        await Promise.resolve();
        await h.lifecycle.finishTimer(timer);

        // 1 セッション = 1 レコード。開始で行を書き、終いに記録する、が 2 周。
        expect(h.calls.order).toEqual(['record', 'nextSession', 'record']);
        expect(h.calls.startNextSession).toBe(1);
        expect(timer.sessionCount).toBe(2);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });
});
