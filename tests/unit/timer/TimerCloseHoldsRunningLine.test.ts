import { describe, it, expect, vi } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { CountdownTimer, CountupTimer, IdleTimer, TimerInstance } from '../../../src/timer/TimerInstance';

/**
 * ✕ の分かれ目（`TimerLifecycle.holdsRunningLine`）。
 *
 * 以前は描画の側が `phase` と `isRunning` で判定していた。countdown は超過で
 * `phase = 'idle'` になり、未開始のタイマーは `isRunning === false` なので、どちらも
 * 確認なしの `closeTimer` に落ち、開いたときに書いた走行中の行がノートに残った。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};

function build() {
    const discardRunningPlaceholder = vi.fn(async (_timer: TimerInstance) => { });
    const onTimerClosed = vi.fn();
    const ctx = {
        timers: new Map<string, TimerInstance>(), recorder: { discardRunningPlaceholder },
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } }, app: {},
        startTimer: () => { }, render: () => { }, renderTimerItem: () => { }, persistTimersToStorage: () => { },
        onTimerClosed, flushTimerContent: async () => true, discardTimerContent: () => { },
    } as unknown as TimerContext;
    const lifecycle = new TimerLifecycle(ctx, new TimerCreator(ctx));
    return { ctx, lifecycle, discardRunningPlaceholder, onTimerClosed };
}

const base = {
    taskId: 'tv-inline:notes/a.md:seq:1', taskName: 'A', taskOriginalText: '- [ ] A', taskFile: 'notes/a.md',
    startTimeMs: Date.now(), pausedElapsedTime: 0, runState: 'running' as const,
    sessionCount: 0, recordedElapsedTime: 0, isExpanded: true, intervalId: null, recordMode: 'child' as const,
    parserId: 'tv-inline' as const, taskColor: '', pendingRecord: null, ownedAnchors: [], opening: null,
    priorStartMs: null, tailRecordBlockId: 'tv-tail',
};

function countdown(overrides: Partial<CountdownTimer> = {}): CountdownTimer {
    return {
        ...base, id: 'd1', timerType: 'countdown', phase: 'work', isRunning: true,
        totalTime: 60, timeRemaining: 60, elapsedTime: 0, ...overrides,
    } as CountdownTimer;
}

function countup(overrides: Partial<CountupTimer> = {}): CountupTimer {
    return { ...base, id: 'c1', timerType: 'countup', phase: 'work', isRunning: true, elapsedTime: 0, ...overrides } as CountupTimer;
}

describe('✕ asks first whenever the timer holds a running line', () => {
    it('a countdown past zero (phase idle, still running) holds its line', () => {
        const h = build();
        expect(h.lifecycle.holdsRunningLine(countdown({ phase: 'idle', timeRemaining: -30, elapsedTime: 90 }))).toBe(true);
    });

    it('a timer opened but not started (isRunning false) holds the line it wrote on open', () => {
        const h = build();
        expect(h.lifecycle.holdsRunningLine(countup({ isRunning: false, phase: 'idle' }))).toBe(true);
    });

    it('a stopped run waiting for its record holds its line', () => {
        const h = build();
        expect(h.lifecycle.holdsRunningLine(countup({
            isRunning: false, pendingRecord: { endMs: Date.now(), seconds: 5, then: 'close' },
        }))).toBe(true);
    });

    it('a suspended timer has recorded everything and closes without asking', () => {
        const h = build();
        expect(h.lifecycle.holdsRunningLine(countup({ isRunning: false, runState: 'suspended' }))).toBe(false);
    });

    it('the idle timer has no line and closes without asking', () => {
        const h = build();
        const idle = { ...base, id: '__idle__', timerType: 'idle', phase: 'idle', isRunning: true, elapsedTime: 0 } as IdleTimer;
        expect(h.lifecycle.holdsRunningLine(idle)).toBe(false);
    });

    it('discarding an overrunning countdown removes its running line, then closes', async () => {
        const h = build();
        const timer = countdown({ phase: 'idle', timeRemaining: -30, elapsedTime: 90 });
        h.ctx.timers.set(timer.id, timer);

        await h.lifecycle.discardTimer(timer);

        expect(h.discardRunningPlaceholder).toHaveBeenCalledWith(timer);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
        expect(h.onTimerClosed).toHaveBeenCalledWith(timer);
    });
});
