import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { IDLE_TIMER_ID, type TimerContext } from '../../../src/timer/TimerContext';
import { getTimerElapsedSeconds, type CountdownTimer, type CountupTimer, type IntervalTimer, type PendingRecord, type TimerInstance } from '../../../src/timer/TimerInstance';
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
    /** 記録のたびに、固定した記録（`pendingRecord`）が終わりとする時刻。 */
    stoppedAt: number[];
}

/** 書き込みの成否。既定は「書けた」。テストが途中で書き換えて失敗を起こす。 */
interface WriteResults {
    flush: boolean;
    record: boolean;
}

function build() {
    const calls: RecorderCalls = { recordSessionEnd: 0, createChildAtStart: 0, startNextSession: 0, discardRunningPlaceholder: 0, order: [], stoppedAt: [] };
    const results: WriteResults = { flush: true, record: true };
    const recorder = {
        recordSessionEnd: async (timer: TimerInstance, record: PendingRecord) => {
            calls.recordSessionEnd++;
            calls.order.push('record');
            calls.stoppedAt.push(record.endMs);
            return results.record;
        },
        createChildAtStart: async () => { calls.createChildAtStart++; calls.order.push('placeholder'); return 'tv-inline:notes/a.md:ln:4'; },
        startNextSession: async () => { calls.startNextSession++; calls.order.push('nextSession'); return true; },
        discardRunningPlaceholder: async () => { calls.discardRunningPlaceholder++; calls.order.push('discard'); },
    };

    let persisted = 0;
    let rendered = 0;
    const ctx = {
        timers: new Map<string, TimerInstance>(),
        recorder: recorder as unknown as TimerContext['recorder'],
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } } as unknown as TimerContext['plugin'],
        app: {} as TimerContext['app'],
        startTimer: () => { /* unused */ },
        render: () => { rendered++; },
        renderTimerItem: () => { /* unused */ },
        persistTimersToStorage: () => { persisted++; },
        onTimerClosed: () => { /* unused */ },
        flushTimerContent: async () => { calls.order.push('flush'); return results.flush; },
        discardTimerContent: () => { calls.order.push('discardContent'); },
        ensureContainer: () => ({}) as HTMLElement,
        destroyContainer: () => { /* unused */ },
        getPinState: () => 'pinned' as const,
        togglePin: () => { /* unused */ },
        shouldShowPinBadge: () => false,
    };

    const creator = new TimerCreator(ctx, { isAutoManagedTimerTargetId: () => false } as unknown as TimerStorageUtils);
    const lifecycle = new TimerLifecycle(ctx, creator);
    return { ctx, lifecycle, calls, results, persistedCount: () => persisted, renderedCount: () => rendered };
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
        recordMode: 'self',
        parserId: 'tv-inline',
        taskColor: '',
        pendingRecord: null,
        opening: null,
        timerType: 'countup',
        elapsedTime: 600,
        recordedChildTaskId: 'tv-inline:notes/a.md:ln:4',
        tailRecordBlockId: 'tv-t-abc1234',
        ...overrides,
    };
    ctx.timers.set(timer.id, timer);
    return timer;
}

const busyOf = (lifecycle: TimerLifecycle) => (lifecycle as unknown as { busy: Set<string> }).busy;

function startInterval(ctx: TimerContext, overrides: Partial<IntervalTimer> = {}): IntervalTimer {
    const timer: IntervalTimer = {
        id: 'timer-i1',
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
        recordMode: 'child',
        parserId: 'tv-inline',
        taskColor: '',
        pendingRecord: null,
        opening: null,
        timerType: 'interval',
        intervalSource: 'pomodoro',
        groups: [{
            repeatCount: 0,
            segments: [
                { label: 'Work', durationSeconds: 1500, type: 'work' },
                { label: 'Break', durationSeconds: 300, type: 'break' },
            ],
        }],
        currentGroupIndex: 0,
        currentSegmentIndex: 0,
        currentRepeatIndex: 0,
        segmentTimeRemaining: 900,
        totalElapsedTime: 600,
        totalDuration: 0,
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
        // 再開は書けてから走行に移る。往復（busy）の間は中断のまま。
        expect(timer.runState).toBe('suspended');
        await vi.waitFor(() => expect(busyOf(h.lifecycle).has(timer.id)).toBe(false));

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
        await vi.waitFor(() => expect(busyOf(h.lifecycle).has((countdown as unknown as TimerInstance).id)).toBe(false));

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
        // v1 の completeTargetTask に当たる書き込みはもう存在しない。記録は走行中の
        // 行の content を読むので、未書き込みの入力を先に流し込む。
        expect(h.calls.order).toEqual(['flush', 'record']);
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

        // 行ごと消えるので、未書き込みの入力は書かずに捨てる。
        expect(h.calls.order).toEqual(['discardContent', 'discard']);
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
        // 再開の往復が済むまで、ほかの出口は受け付けない（TimerLifecycle.busy）。
        await new Promise(r => setTimeout(r, 0));
        await h.lifecycle.finishTimer(timer);

        // 1 セッション = 1 レコード。開始で行を書き、終いに記録する、が 2 周。
        // 記録と、尻尾が動く再開の前後には content の書き出しが挟まる。
        expect(h.calls.order).toEqual([
            'flush', 'record',
            'flush', 'nextSession', 'flush',
            'flush', 'record',
        ]);
        expect(h.calls.startNextSession).toBe(1);
        expect(timer.sessionCount).toBe(2);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });
});

/**
 * ■ interval の停止。prepare を挟む点が countup / countdown と違うが、記録の
 * 書き方は同じで、flush してから 1 本書いて閉じる。以前はこの列が
 * `TimerRenderer` の 2 つの停止ハンドラに書かれていて、2026-08-17 に flush を
 * 足したとき片方だけが直った。どの状態から入っても同じ 1 本を通ることを固定する。
 */
describe('interval stop', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); intervals.length = 0; });

    it('flushes the typed content before writing the record', async () => {
        const timer = startInterval(h.ctx);
        await h.lifecycle.stopIntervalTimer(timer);

        expect(h.calls.order).toEqual(['flush', 'record']);
        expect(h.calls.recordSessionEnd).toBe(1);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });

    it('takes the same path from prepare', async () => {
        const timer = startInterval(h.ctx);
        // prepare は実際の遷移で作る（待機の起点は lifecycle が内部に持つ）。
        h.lifecycle.pauseIntervalToPrepare(timer);
        await h.lifecycle.stopIntervalTimer(timer);

        expect(h.calls.order).toEqual(['flush', 'record']);
        // 走った 600 秒は prepare をまたいでも残る。
        expect(timer.totalElapsedTime).toBe(600);
    });

    it('takes the same path from the state only a crash-restore can produce', async () => {
        // 区間中のまま走っていない形。UI 操作では作れないが、停止の記録待ちで
        // 落ちると localStorage に残り、復元でここに来る。
        const timer = startInterval(h.ctx, { isRunning: false });
        await h.lifecycle.stopIntervalTimer(timer);

        expect(h.calls.order).toEqual(['flush', 'record']);
        expect(h.ctx.timers.has(timer.id)).toBe(false);
    });

    it('counts the running stretch into the session before recording it', async () => {
        const timer = startInterval(h.ctx);
        await h.lifecycle.stopIntervalTimer(timer);

        expect(timer.pausedElapsedTime).toBeGreaterThanOrEqual(600);
    });
});

/**
 * 記録を書けなかった出口。widget は閉じず、計測は一時停止のまま残し、合計と
 * 回数を進めない。理由の通知は書き込みの層が出すので、ここでは見ない。もう一度
 * 同じ出口を押せば記録をやり直し、そのとき経過を二重に足さない。
 */
describe('an exit whose record was not written', () => {
    let h: ReturnType<typeof build>;
    const T0 = new Date('2026-09-23T10:00:00Z').getTime();
    beforeEach(() => {
        h = build();
        intervals.length = 0;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(T0);
    });
    afterEach(() => { vi.useRealTimers(); });

    function expectKept(timer: TimerInstance, persistedBefore: number) {
        expect(h.ctx.timers.has(timer.id)).toBe(true);
        expect(timer.recordedElapsedTime).toBe(0);
        expect(timer.sessionCount).toBe(0);
        expect(h.persistedCount()).toBeGreaterThan(persistedBefore);
        expect(timer.isRunning).toBe(false);
    }

    describe('finish', () => {
        it('keeps the widget and the measurement when the record fails', async () => {
            const timer = startCountup(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.record = false;
            const before = h.persistedCount();

            await h.lifecycle.finishTimer(timer);

            expect(h.calls.order).toEqual(['flush', 'record']);
            expectKept(timer, before);
            expect(timer.runState).toBe('running');
            expect(timer.pausedElapsedTime).toBe(600);
        });

        it('does not record when the typed name could not be written', async () => {
            const timer = startCountup(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.flush = false;
            const before = h.persistedCount();

            await h.lifecycle.finishTimer(timer);

            expect(h.calls.order).toEqual(['flush']);
            expect(h.calls.recordSessionEnd).toBe(0);
            expectKept(timer, before);
        });

        it('closes as before when the record is written', async () => {
            const timer = startCountup(h.ctx, { startTimeMs: T0 - 600_000 });
            await h.lifecycle.finishTimer(timer);

            expect(h.ctx.timers.has(timer.id)).toBe(false);
            expect(timer.recordedElapsedTime).toBe(600);
            expect(timer.sessionCount).toBe(1);
        });

        it('records again on a second press without counting the run twice', async () => {
            const timer = startCountup(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.record = false;
            await h.lifecycle.finishTimer(timer);
            const pausedAfterFailure = timer.pausedElapsedTime;
            const elapsedAfterFailure = getTimerElapsedSeconds(timer);
            expect(elapsedAfterFailure).toBe(600);

            // 失敗のあと時間が経っても、止まった計測は伸びない。
            vi.setSystemTime(T0 + 120_000);
            expect(getTimerElapsedSeconds(timer)).toBe(elapsedAfterFailure);

            h.results.record = true;
            await h.lifecycle.finishTimer(timer);

            expect(h.calls.recordSessionEnd).toBe(2);
            expect(timer.pausedElapsedTime).toBe(pausedAfterFailure);
            expect(timer.recordedElapsedTime).toBe(600);
            expect(timer.sessionCount).toBe(1);
            expect(h.ctx.timers.has(timer.id)).toBe(false);
            // 押し直した記録も、最初に押した時刻で終わる。待った 120 秒は記録の幅に入らない。
            expect(h.calls.stoppedAt).toEqual([T0, T0]);
            expect(timer.pendingRecord).toBeNull();
        });
    });

    describe('suspend', () => {
        it('stays running (not suspended) when the record fails', async () => {
            const timer = startCountup(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.record = false;
            const before = h.persistedCount();

            await h.lifecycle.suspendTimer(timer);

            expectKept(timer, before);
            expect(timer.runState).toBe('running');
        });

        it('does not record when the typed name could not be written', async () => {
            const timer = startCountup(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.flush = false;
            const before = h.persistedCount();

            await h.lifecycle.suspendTimer(timer);

            expect(h.calls.recordSessionEnd).toBe(0);
            expectKept(timer, before);
            expect(timer.runState).toBe('running');
        });

        it('suspends as before when the record is written', async () => {
            const timer = startCountup(h.ctx, { startTimeMs: T0 - 600_000 });
            await h.lifecycle.suspendTimer(timer);

            expect(h.ctx.timers.has(timer.id)).toBe(true);
            expect(timer.runState).toBe('suspended');
            expect(timer.recordedElapsedTime).toBe(600);
            expect(timer.sessionCount).toBe(1);
        });

        it('records again on a second press without counting the run twice', async () => {
            const timer = startCountup(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.record = false;
            await h.lifecycle.suspendTimer(timer);
            const pausedAfterFailure = timer.pausedElapsedTime;
            const elapsedAfterFailure = getTimerElapsedSeconds(timer);

            vi.setSystemTime(T0 + 120_000);
            expect(getTimerElapsedSeconds(timer)).toBe(elapsedAfterFailure);
            h.results.record = true;
            await h.lifecycle.suspendTimer(timer);

            expect(h.calls.recordSessionEnd).toBe(2);
            expect(timer.pausedElapsedTime).toBe(pausedAfterFailure);
            expect(timer.recordedElapsedTime).toBe(600);
            expect(timer.sessionCount).toBe(1);
            expect(timer.runState).toBe('suspended');
        });
    });

    describe('interval stop', () => {
        it('keeps the widget when the record fails', async () => {
            const timer = startInterval(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.record = false;
            const before = h.persistedCount();

            await h.lifecycle.stopIntervalTimer(timer);

            expectKept(timer, before);
        });

        it('does not record when the typed name could not be written', async () => {
            const timer = startInterval(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.flush = false;
            const before = h.persistedCount();

            await h.lifecycle.stopIntervalTimer(timer);

            expect(h.calls.recordSessionEnd).toBe(0);
            expectKept(timer, before);
        });

        it('closes as before when the record is written', async () => {
            const timer = startInterval(h.ctx, { startTimeMs: T0 - 600_000 });
            await h.lifecycle.stopIntervalTimer(timer);
            expect(h.ctx.timers.has(timer.id)).toBe(false);
        });
    });

    describe('interval finish (the last segment ran out)', () => {
        const finishInterval = (timer: IntervalTimer) =>
            (h.lifecycle as unknown as { finishIntervalTimer(id: string, t: IntervalTimer): Promise<void> })
                .finishIntervalTimer(timer.id, timer);

        it('keeps the widget and returns to the segment it stopped in', async () => {
            const timer = startInterval(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.record = false;
            const before = h.persistedCount();

            await finishInterval(timer);

            expectKept(timer, before);
            // 'idle' のままだと操作列に ■ が出ず、記録をやり直せない。
            expect(timer.phase).toBe('work');
        });

        it('returns to break when it stopped in a break', async () => {
            const timer = startInterval(h.ctx, { startTimeMs: T0 - 600_000, phase: 'break', currentSegmentIndex: 1 });
            h.results.record = false;

            await finishInterval(timer);

            expect(timer.phase).toBe('break');
            expect(h.ctx.timers.has(timer.id)).toBe(true);
        });

        it('does not record when the typed name could not be written', async () => {
            const timer = startInterval(h.ctx, { startTimeMs: T0 - 600_000 });
            h.results.flush = false;
            const before = h.persistedCount();

            await finishInterval(timer);

            expect(h.calls.recordSessionEnd).toBe(0);
            expectKept(timer, before);
            expect(timer.phase).toBe('work');
        });

        it('closes as before when the record is written', async () => {
            const timer = startInterval(h.ctx, { startTimeMs: T0 - 600_000 });
            await finishInterval(timer);
            expect(h.ctx.timers.has(timer.id)).toBe(false);
        });
    });
});

/**
 * 記録を書けずに一時停止のまま残った走行か。✕ はこれが真なら確認を挟む。
 *
 * `holdsUnrecordedRun` は無くなり、状態は `timer.pendingRecord` が直接持つ
 * （null なら無い）。ヒューリスティック（phase や pausedElapsedTime から推測）
 * は無くなったので、ここでは実際に記録を失敗させて pendingRecord が立つことを
 * 見る。組み立てただけの静的な形からの推測は前提が消えている。
 */
describe('pendingRecord: a run held after a failed exit', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); intervals.length = 0; });

    it('is set for a countup whose finish could not be recorded', async () => {
        const timer = startCountup(h.ctx);
        h.results.record = false;
        await h.lifecycle.finishTimer(timer);
        expect(timer.pendingRecord).not.toBeNull();
    });

    it('is set for a countdown whose suspend could not be recorded', async () => {
        const timer = startCountup(h.ctx) as unknown as CountdownTimer;
        (timer as unknown as { timerType: string }).timerType = 'countdown';
        timer.totalTime = 1500;
        timer.timeRemaining = 900;
        h.results.record = false;
        await h.lifecycle.suspendTimer(timer as unknown as TimerInstance);
        expect((timer as unknown as TimerInstance).pendingRecord).not.toBeNull();
    });

    it('is set for an interval whose stop could not be recorded', async () => {
        const timer = startInterval(h.ctx);
        h.results.record = false;
        await h.lifecycle.stopIntervalTimer(timer);
        expect(timer.pendingRecord).not.toBeNull();
    });

    it('is null while suspended', () => {
        const timer = startCountup(h.ctx, { runState: 'suspended', isRunning: false, pausedElapsedTime: 600 });
        expect(timer.pendingRecord).toBeNull();
    });

    it('is null while running', () => {
        expect(startCountup(h.ctx).pendingRecord).toBeNull();
        expect(startInterval(h.ctx).pendingRecord).toBeNull();
    });

    it('is null before anything was measured', () => {
        const timer = startCountup(h.ctx, { isRunning: false, pausedElapsedTime: 0 });
        expect(timer.pendingRecord).toBeNull();
    });

    it('is null for an interval paused into prepare, which is running', () => {
        const timer = startInterval(h.ctx, { isRunning: true, phase: 'prepare' });
        expect(timer.pendingRecord).toBeNull();
    });

    it('is set for an interval stopped in prepare whose record could not be written', async () => {
        const timer = startInterval(h.ctx);
        h.lifecycle.pauseIntervalToPrepare(timer);
        h.results.record = false;

        await h.lifecycle.stopIntervalTimer(timer);

        expect(timer.phase).toBe('prepare');
        expect(timer.isRunning).toBe(false);
        expect(timer.pendingRecord).not.toBeNull();
        expect(h.ctx.timers.has(timer.id)).toBe(true);
    });

    it('is set for a countdown stopped past zero, whose phase went idle', async () => {
        // Pausing past zero sets the phase to 'idle' (pauseTimer), so the close
        // button's idle branch must not take this run away unasked.
        const countdown = startCountup(h.ctx) as unknown as CountdownTimer;
        (countdown as unknown as { timerType: string }).timerType = 'countdown';
        countdown.totalTime = 300; // ran 600 s: 300 s past zero
        h.results.record = false;

        await h.lifecycle.finishTimer(countdown as unknown as TimerInstance);

        expect(countdown.phase).toBe('idle');
        expect((countdown as unknown as TimerInstance).pendingRecord).not.toBeNull();
    });
});
