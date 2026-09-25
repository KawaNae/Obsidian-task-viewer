import { describe, it, expect, afterEach, vi } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRenderer } from '../../../src/timer/TimerRenderer';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerContentBinding } from '../../../src/timer/TimerContentBinding';
import type { CountupTimer, IntervalTimer, PendingRecord, TimerInstance } from '../../../src/timer/TimerInstance';
import { t } from '../../../src/i18n';

/**
 * 記録を書けずに残った走行の操作列。
 *
 * - 1 秒未満で止めて書けなかった走行は経過が 0 でも「未開始」ではない。▶ 開始を
 *   出すと `pendingRecord` を持ったまま次の走行が始まり、後の記録が古い時刻で
 *   終わる。
 * - interval の自動終了を書けなかった走行は、続ける区間が無いので ■ だけ。▶ を
 *   出すと次の tick ですぐ満了し、押した時刻で終わる記録になる。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};

interface FakeEl {
    labels: string[];
    createEl(tag: string, options?: { cls?: string; text?: string }): FakeEl & { onclick?: () => void };
    createSpan(options?: { cls?: string; text?: string }): FakeEl;
}

/** ボタンのラベルだけを集める器（createControlButton が使う createEl / createSpan だけ）。 */
function fakeContainer(): FakeEl {
    const labels: string[] = [];
    const make = (): FakeEl => ({
        labels,
        createEl: () => make(),
        createSpan: (options) => {
            if (options?.text) labels.push(options.text);
            return make();
        },
    });
    return make();
}

function build(opts: { flushOk?: boolean; recordOk?: boolean } = {}) {
    const results = { flush: opts.flushOk ?? true, record: opts.recordOk ?? true };
    const recorder = {
        recordSessionEnd: async (_timer: TimerInstance, _record: PendingRecord) => results.record,
        extendRunningSession: async () => Date.now() + 3_600_000,
    };
    const ctx = {
        timers: new Map<string, TimerInstance>(), recorder,
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } }, app: {},
        startTimer: () => { }, render: () => { }, renderTimerItem: () => { }, persistTimersToStorage: () => { },
        onTimerClosed: () => { }, flushTimerContent: async () => results.flush, discardTimerContent: () => { },
        ensureContainer: () => ({}) as HTMLElement, destroyContainer: () => { },
        getPinState: () => 'pinned' as const, togglePin: () => { }, shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    const creator = new TimerCreator(ctx);
    const lifecycle = new TimerLifecycle(ctx, creator);
    const renderer = new TimerRenderer(ctx, lifecycle, creator, {} as TimerContentBinding);
    const controls = (timer: TimerInstance): string[] => {
        const container = fakeContainer();
        (renderer as unknown as { renderControls(c: unknown, t: TimerInstance): void }).renderControls(container, timer);
        return container.labels;
    };
    return { ctx, lifecycle, controls, results };
}

function countup(overrides: Partial<CountupTimer> = {}): CountupTimer {
    return {
        id: 'c1', taskId: 'tv-inline:notes/a.md:seq:1', taskName: 'A', taskOriginalText: '- [ ] A', taskFile: 'notes/a.md',
        startTimeMs: Date.now(), pausedElapsedTime: 0, elapsedTime: 0, phase: 'work', isRunning: true, runState: 'running',
        sessionCount: 0, recordedElapsedTime: 0, isExpanded: true, intervalId: null, recordMode: 'self',
        parserId: 'tv-inline', taskColor: '', pendingRecord: null, timerType: 'countup',
        ...overrides,
    } as CountupTimer;
}

function interval(overrides: Partial<IntervalTimer> = {}): IntervalTimer {
    return {
        id: 'i1', taskId: 'tv-inline:notes/a.md:seq:1', taskName: 'A', taskOriginalText: '- [ ] A', taskFile: 'notes/a.md',
        startTimeMs: Date.now() - 300_000, pausedElapsedTime: 0, phase: 'break', isRunning: true, runState: 'running',
        sessionCount: 0, recordedElapsedTime: 0, isExpanded: true, intervalId: null, recordMode: 'child',
        parserId: 'tv-inline', taskColor: '', pendingRecord: null, timerType: 'interval', intervalSource: 'pomodoro',
        groups: [{ repeatCount: 1, segments: [
            { label: 'Work', durationSeconds: 1500, type: 'work' },
            { label: 'Break', durationSeconds: 300, type: 'break' },
        ] }],
        currentGroupIndex: 0, currentSegmentIndex: 1, currentRepeatIndex: 0,
        segmentTimeRemaining: 0, totalElapsedTime: 1800, totalDuration: 1800,
        ...overrides,
    } as IntervalTimer;
}

describe('a run stopped under a second and not recorded is not "never started"', () => {
    afterEach(() => vi.useRealTimers());

    it('■ at 0.5 s whose name cannot be written: no ▶ Start, ■ is there to retry, ✕ asks first', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 21, 9, 0, 0));
        const h = build({ flushOk: false });
        const timer = countup();
        h.ctx.timers.set(timer.id, timer);

        vi.setSystemTime(new Date(2026, 8, 21, 9, 0, 0, 500));
        await h.lifecycle.finishTimer(timer);

        expect(h.ctx.timers.has(timer.id)).toBe(true);
        expect(timer.pendingRecord?.endMs).toBe(new Date(2026, 8, 21, 9, 0, 0, 500).getTime());
        expect(timer.pendingRecord?.then).toBe('close');
        expect(timer.elapsedTime).toBe(0);
        expect(timer.sessionCount).toBe(0);
        const labels = h.controls(timer);
        expect(labels).not.toContain(t('timer.start'));
        expect(labels).toContain(t('timer.finish'));
    });

    it('a timer that has not run shows ▶ Start and holds nothing', () => {
        const h = build();
        const timer = countup({ isRunning: false, startTimeMs: 0 });
        expect(h.controls(timer)).toEqual([t('timer.start')]);
        expect(timer.pendingRecord).toBeNull();
    });

    // 'stoppedAtMs alone, with nothing elapsed, is an unrecorded run' を削除:
    // stoppedAtMs は無くなり、記録待ちは常に pendingRecord（endMs と固定した
    // seconds を持つ）で表す。「0 秒の走行でも未記録なら保持する」という同じ
    // 意図は、上の '■ at 0.5 s...' が pendingRecord ごと既に固定している。
});

describe('an interval whose automatic end was not recorded offers only ■', () => {
    afterEach(() => vi.useRealTimers());

    it('the last segment ends, the record fails: the controls are ■ alone', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 21, 9, 30, 0));
        const h = build({ recordOk: false });
        const timer = interval();
        h.ctx.timers.set(timer.id, timer);

        (h.lifecycle as unknown as { tick(id: string): void }).tick(timer.id);
        await vi.waitFor(() => expect(timer.phase).toBe('break'));
        await new Promise(r => setTimeout(r, 0));

        expect(h.ctx.timers.has(timer.id)).toBe(true);
        expect(timer.isRunning).toBe(false);
        expect(timer.segmentTimeRemaining).toBe(0);
        expect(timer.pendingRecord).not.toBeNull();
        expect(h.controls(timer)).toEqual([t('timer.stop')]);
    });

    // 'a segment stopped with time left (restored from storage) still offers
    // ▶ and ■' を削除: work/break で isRunning=false かつ pendingRecord 無しを
    // 「一時停止として ▶+■ を出す」旧分岐は無くなった。renderIntervalControls は
    // pendingRecord だけで [stop] を出し、無ければ phase（idle/prepare/それ以外）
    // だけで分ける — isRunning は見ない。今は常に [pause] を返す。
});
