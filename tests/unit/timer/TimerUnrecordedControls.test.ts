import { describe, it, expect, afterEach, vi } from 'vitest';
import { TimerBoard } from '../../../src/timer/TimerBoard';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRenderer } from '../../../src/timer/TimerRenderer';
import { TimerRuntime } from '../../../src/timer/TimerRuntime';
import type { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerContentBinding } from '../../../src/timer/TimerContentBinding';
import { freeze, restart } from '../../../src/timer/TimerClock';
import { pomodoroGroups, START_CURSOR } from '../../../src/timer/IntervalMath';
import { newTimerId, type Session, type TimerState } from '../../../src/timer/TimerState';
import type { Measure } from '../../../src/timer/TimerProgress';
import { t } from '../../../src/i18n';

/**
 * 操作列は記録の区切りだけで決まり、種類（countup、countdown、ポモドーロ）を問わない。
 *
 *   走行中   … [⏸ 中断][■ 終了]
 *   記録待ち … [⏸ 中断][■ 終了]（固定した記録を書き直す。押した方が行き先）
 *   中断中   … [▶ 再開][■ 終了]
 *
 * 1 秒未満で止めて書けなかった走行も、経過が 0 でも記録待ちであり、「開始」の
 * ボタンは無い（未開始の状態は無い）。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};

/** ボタンのラベルだけを集める器（createControlButton が使う createEl と createSpan だけ）。 */
function fakeContainer(labels: string[]): unknown {
    return {
        createEl: () => fakeContainer(labels),
        createSpan: (options?: { text?: string }) => {
            if (options?.text) labels.push(options.text);
            return fakeContainer(labels);
        },
    };
}

function build(opts: { flushOk?: boolean; recordOk?: boolean } = {}) {
    const board = new TimerBoard({ persist: () => { }, render: () => { } });
    const runtime = new TimerRuntime();
    const recorder = {
        recordSessionEnd: async () => opts.recordOk ?? true,
        extendRunningSession: async () => Date.now() + 3_600_000,
        releaseAnchors: async () => { },
    } as unknown as TimerRecorder;
    const content = { flush: async () => opts.flushOk ?? true, discard: () => { }, release: () => { } };
    const lifecycle = new TimerLifecycle({ board, runtime, recorder, content, renderTimes: () => { } });
    const renderer = new TimerRenderer({
        app: {} as never, plugin: {} as never, board, runtime, lifecycle,
        contentBinding: {} as TimerContentBinding,
        container: {} as never,
        startTimer: () => { },
    });
    const controls = (timer: TimerState): string[] => {
        const labels: string[] = [];
        (renderer as unknown as { renderControls(c: unknown, t: TimerState): void }).renderControls(fakeContainer(labels), timer);
        return labels;
    };
    return { board, lifecycle, controls };
}

function timerIn(board: TimerBoard, session: Session, measure: Measure = { type: 'countup' }): TimerState {
    const now = Date.now();
    const clock = restart(now);
    const timer: TimerState = {
        id: newTimerId(),
        subject: { kind: 'task', anchor: 'box' },
        file: 'notes/a.md', name: 'A', color: '', mode: 'child',
        measure,
        clock: session.kind === 'running' ? clock : freeze(clock, now),
        session,
        tail: 'tv-tail', owned: [], opening: null,
        recorded: { seconds: 0, count: 0 }, priorStartMs: null, draft: null, expanded: true,
    };
    board.add(timer);
    return timer;
}

const POMODORO: Measure = { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(25, 5), at: START_CURSOR };
const RUN = [t('timer.suspend'), t('timer.finish')];

describe('the controls follow the session alone', () => {
    it('running and waiting to record: ⏸ and ■, for every kind', () => {
        const h = build();
        for (const measure of [{ type: 'countup' } as Measure, { type: 'countdown', totalSeconds: 60 } as Measure, POMODORO]) {
            expect(h.controls(timerIn(h.board, { kind: 'running', from: 0 }, measure))).toEqual(RUN);
            expect(h.controls(timerIn(h.board,
                { kind: 'pending', record: { endMs: 0, seconds: 0, then: 'close' } }, measure))).toEqual(RUN);
        }
    });

    it('suspended: ▶ and ■, for every kind', () => {
        const h = build();
        for (const measure of [{ type: 'countup' } as Measure, POMODORO]) {
            expect(h.controls(timerIn(h.board, { kind: 'suspended' }, measure))).toEqual([t('timer.resume'), t('timer.finish')]);
        }
    });
});

describe('a run stopped under a second and not recorded waits to record', () => {
    afterEach(() => vi.useRealTimers());

    it('■ at 0.5 s whose name cannot be written: no start button, ■ is there to retry, ✕ asks first', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 21, 9, 0, 0));
        const h = build({ flushOk: false });
        const timer = timerIn(h.board, { kind: 'running', from: 0 });

        vi.setSystemTime(new Date(2026, 8, 21, 9, 0, 0, 500));
        await h.lifecycle.stop(timer, 'close');

        expect(h.board.has(timer)).toBe(true);
        expect(timer.session).toEqual({
            kind: 'pending',
            record: { endMs: new Date(2026, 8, 21, 9, 0, 0, 500).getTime(), seconds: 0, then: 'close' },
        });
        expect(timer.recorded).toEqual({ seconds: 0, count: 0 });
        const labels = h.controls(timer);
        expect(labels).not.toContain(t('timer.start'));
        expect(labels).toEqual(RUN);
        expect(h.lifecycle.close(timer, false)).toBe('confirm');
    });
});
