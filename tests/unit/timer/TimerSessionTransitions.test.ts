import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { TimerBoard } from '../../../src/timer/TimerBoard';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRuntime } from '../../../src/timer/TimerRuntime';
import type { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { readSeconds, restart } from '../../../src/timer/TimerClock';
import { pomodoroGroups, START_CURSOR } from '../../../src/timer/IntervalMath';
import type { Measure } from '../../../src/timer/TimerProgress';
import { newTimerId, type PendingRecord, type TimerState } from '../../../src/timer/TimerState';

/**
 * 出口（⏸ 中断 / ▶ 再開 / ■ 終了 / ✕ 破棄）の遷移（`TimerLifecycle`）。
 *
 * 記録の中身は recorder が持つので、ここで見るのは「いつ呼ばれるか」と「呼んだ
 * 後の状態」。規則は「書けてから状態を進める」。⏸ と ■ は時計を止めて記録を固定し
 * （記録待ち）、書けたら ⏸ は中断、■ は閉じる。書けなければ記録待ちのまま残る。
 * 終了はタスクの状態を触らず、中断は尻尾（次の再開の足場）を手放さない。
 * countup、countdown、ポモドーロは同じ出口を通る。
 */

(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
};

/** 書き込みの成否。既定は「書けた」。テストが途中で書き換えて失敗を起こす。 */
interface WriteResults {
    flush: boolean;
    record: boolean;
    next: boolean;
}

function build() {
    const order: string[] = [];
    /** 記録のたびに、固定した記録。 */
    const records: PendingRecord[] = [];
    const results: WriteResults = { flush: true, record: true, next: true };
    const recorder = {
        recordSessionEnd: async (_timer: TimerState, record: PendingRecord) => {
            order.push('record');
            records.push(record);
            return results.record;
        },
        startNextSession: async () => { order.push('nextSession'); return results.next; },
        discardRunningPlaceholder: async () => { order.push('discard'); },
        releaseAnchors: async () => { order.push('releaseAnchors'); },
        extendRunningSession: async () => Date.now() + 3_600_000,
    } as unknown as TimerRecorder;
    const content = {
        flush: async () => { order.push('flush'); return results.flush; },
        discard: () => { order.push('discardContent'); },
        release: () => { order.push('release'); },
    };
    let persisted = 0;
    const board = new TimerBoard({ persist: () => { persisted++; }, render: () => { } });
    const runtime = new TimerRuntime();
    const lifecycle = new TimerLifecycle({ board, runtime, recorder, content, renderTimes: () => { } });
    return { board, runtime, lifecycle, order, records, results, persistedCount: () => persisted };
}

const T0 = new Date('2026-09-23T10:00:00Z').getTime();
const POMODORO: Measure = { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(25, 5), at: START_CURSOR };

/** 10 分走ったタイマー。 */
function running(board: TimerBoard, measure: Measure = { type: 'countup' }, overrides: Partial<TimerState> = {}): TimerState {
    const timer: TimerState = {
        id: newTimerId(),
        subject: { kind: 'task', anchor: 'box' },
        file: 'notes/a.md', name: 'A', color: '', mode: 'self',
        measure,
        clock: restart(Date.now() - 600_000),
        session: { kind: 'running', from: 0 },
        tail: 'tv-t-abc1234', owned: ['tv-t-abc1234'], opening: null,
        recorded: { seconds: 0, count: 0 }, priorStartMs: null, draft: null, expanded: true,
        ...overrides,
    };
    board.add(timer);
    return timer;
}

describe('the exits', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => {
        h = build();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    describe('⏸ suspend', () => {
        it('records the run and keeps the widget, folded', async () => {
            const timer = running(h.board);
            await h.lifecycle.stop(timer, 'suspend');

            // 記録は走行中の行の名前を読むので、打った名前を先に書き出す。
            expect(h.order).toEqual(['flush', 'record']);
            expect(h.records).toEqual([{ endMs: T0, seconds: 600, then: 'suspend' }]);
            expect(h.board.has(timer)).toBe(true);
            expect(timer.session).toEqual({ kind: 'suspended' });
            expect(timer.clock).toEqual({ kind: 'frozen', seconds: 600 });
            expect(timer.recorded).toEqual({ seconds: 600, count: 1 });
            expect(timer.expanded).toBe(false);
        });

        it('keeps the tail so the next resume knows what to sit beside', async () => {
            const timer = running(h.board);
            await h.lifecycle.stop(timer, 'suspend');

            // 記録し終えた行がそのまま尻尾。ここを手放すと再開が置き場を失う。
            expect(timer.tail).toBe('tv-t-abc1234');
            expect(timer.owned).toEqual(['tv-t-abc1234']);
            // mode は 1 本目の書き方であって、中断で書き換わるものではない。
            expect(timer.mode).toBe('self');
        });

        it('is a no-op for a timer that is already suspended', async () => {
            const timer = running(h.board);
            await h.lifecycle.stop(timer, 'suspend');
            h.order.length = 0;

            await h.lifecycle.stop(timer, 'suspend');
            expect(h.order).toEqual([]);
            expect(timer.recorded.count).toBe(1);
        });

        it('a pomodoro suspends the same way', async () => {
            const timer = running(h.board, POMODORO);
            await h.lifecycle.stop(timer, 'suspend');

            expect(h.order).toEqual(['flush', 'record']);
            expect(timer.session).toEqual({ kind: 'suspended' });
            expect(timer.recorded).toEqual({ seconds: 600, count: 1 });
        });
    });

    describe('▶ resume', () => {
        it('stays suspended while the new line is written, then starts a fresh run from the press', async () => {
            const timer = running(h.board);
            await h.lifecycle.stop(timer, 'suspend');
            h.order.length = 0;

            vi.setSystemTime(T0 + 300_000);
            const resumed = h.lifecycle.resume(timer);
            // 再開は書けてから走行に移る。往復の間は中断のまま。
            expect(timer.session).toEqual({ kind: 'suspended' });
            await resumed;

            // 中断中に打たれた名前は直前の記録の行宛て。新しい行の前に書き出し、
            // 往復の間に打たれた名前は新しい行が受け取る。
            expect(h.order).toEqual(['flush', 'nextSession', 'flush']);
            expect(timer.session).toEqual({ kind: 'running', from: 0 });
            expect(timer.clock).toEqual({ kind: 'running', startMs: T0 + 300_000 });
            expect(timer.recorded).toEqual({ seconds: 600, count: 1 }); // 合計は保持
            expect(timer.expanded).toBe(true);
        });

        it('restarts a countdown from a full clock', async () => {
            const timer = running(h.board, { type: 'countdown', totalSeconds: 1500 });
            await h.lifecycle.stop(timer, 'suspend');
            vi.setSystemTime(T0 + 60_000);
            await h.lifecycle.resume(timer);

            expect(readSeconds(timer.clock, Date.now())).toBe(0);
            expect(timer.session).toEqual({ kind: 'running', from: 0 });
        });

        it('a pomodoro goes on from where it stopped', async () => {
            const timer = running(h.board, POMODORO);
            await h.lifecycle.stop(timer, 'suspend');
            vi.setSystemTime(T0 + 3_600_000);
            await h.lifecycle.resume(timer);

            expect(timer.session).toEqual({ kind: 'running', from: 600 });
            expect(readSeconds(timer.clock, Date.now())).toBe(600);
        });

        it('stays suspended when the new line cannot be written', async () => {
            const timer = running(h.board);
            await h.lifecycle.stop(timer, 'suspend');
            h.results.next = false;

            await h.lifecycle.resume(timer);
            expect(timer.session).toEqual({ kind: 'suspended' });
            expect(timer.clock).toEqual({ kind: 'frozen', seconds: 600 });
        });

        it('does not write a new line when the typed name could not be written', async () => {
            const timer = running(h.board);
            await h.lifecycle.stop(timer, 'suspend');
            h.order.length = 0;
            h.results.flush = false;

            await h.lifecycle.resume(timer);
            expect(h.order).toEqual(['flush']);
            expect(timer.session).toEqual({ kind: 'suspended' });
        });

        it('is a no-op for a running timer', async () => {
            const timer = running(h.board);
            await h.lifecycle.resume(timer);
            expect(h.order).toEqual([]);
        });
    });

    describe('■ finish', () => {
        it('records the run and closes, without touching the task state', async () => {
            const timer = running(h.board);
            await h.lifecycle.stop(timer, 'close');

            // 記録して閉じるだけ。完了は checkbox でユーザーが宣言する。閉じたあと、
            // 打った名前を書き切ってから錨を外す。
            await vi.waitFor(() => expect(h.order).toContain('releaseAnchors'));
            expect(h.order).toEqual(['flush', 'record', 'flush', 'release', 'releaseAnchors']);
            expect(h.records).toEqual([{ endMs: T0, seconds: 600, then: 'close' }]);
            expect(h.board.has(timer)).toBe(false);
        });

        it('does not record again when the timer was already suspended', async () => {
            const timer = running(h.board);
            await h.lifecycle.stop(timer, 'suspend');
            h.order.length = 0;

            await h.lifecycle.stop(timer, 'close');

            expect(h.order).not.toContain('record');
            expect(timer.recorded.count).toBe(1);
            expect(h.board.has(timer)).toBe(false);
        });

        it('a pomodoro finishes while running, the same way', async () => {
            const timer = running(h.board, POMODORO);
            await h.lifecycle.stop(timer, 'close');
            expect(h.records).toEqual([{ endMs: T0, seconds: 600, then: 'close' }]);
            expect(h.board.has(timer)).toBe(false);
        });
    });

    describe('✕ discard', () => {
        it('drops the run without recording it, and cleans up its line', async () => {
            const timer = running(h.board);
            expect(h.lifecycle.close(timer, true)).toBe('closing');
            await vi.waitFor(() => expect(h.order).toContain('releaseAnchors'));

            // 行ごと消えるので、打った名前は書かずに捨てる。
            expect(h.order.slice(0, 2)).toEqual(['discardContent', 'discard']);
            expect(h.order).not.toContain('record');
            expect(timer.recorded.count).toBe(0);
            expect(h.board.has(timer)).toBe(false);
        });
    });

    describe('the session cycle', () => {
        it('records once per run across ⏸ → ▶ → ■', async () => {
            const timer = running(h.board);

            await h.lifecycle.stop(timer, 'suspend');
            vi.setSystemTime(T0 + 60_000);
            await h.lifecycle.resume(timer);
            vi.setSystemTime(T0 + 360_000);
            await h.lifecycle.stop(timer, 'close');

            // 1 つの走行 = 1 つの記録。開始で行を書き、終いに記録する、が 2 周。
            expect(h.order.slice(0, 7)).toEqual([
                'flush', 'record',
                'flush', 'nextSession', 'flush',
                'flush', 'record',
            ]);
            expect(h.records.map(r => r.seconds)).toEqual([600, 300]);
            expect(h.board.has(timer)).toBe(false);
        });
    });
});

/**
 * 記録を書けなかった出口。widget は閉じず、時計は止まったまま、合計と回数を進め
 * ない（記録待ち）。理由の通知は書き込みの層が出すので、ここでは見ない。もう一度
 * 出口を押せば、固定した時刻と長さで書き直す。
 */
describe('an exit whose record was not written', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => {
        h = build();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    function expectKept(timer: TimerState, then: PendingRecord['then'], persistedBefore: number) {
        expect(h.board.has(timer)).toBe(true);
        expect(timer.session).toEqual({ kind: 'pending', record: { endMs: T0, seconds: 600, then } });
        expect(timer.clock).toEqual({ kind: 'frozen', seconds: 600 });
        expect(timer.recorded).toEqual({ seconds: 0, count: 0 });
        expect(h.persistedCount()).toBeGreaterThan(persistedBefore);
    }

    for (const [kind, measure] of [
        ['countup', { type: 'countup' }],
        ['countdown past zero', { type: 'countdown', totalSeconds: 300 }],
        ['pomodoro', POMODORO],
    ] as [string, Measure][]) {
        describe(kind, () => {
            it('■ keeps the widget and the fixed record when the record fails', async () => {
                const timer = running(h.board, measure);
                h.results.record = false;
                const before = h.persistedCount();

                await h.lifecycle.stop(timer, 'close');
                h.board.flush();

                expect(h.order).toEqual(['flush', 'record']);
                expectKept(timer, 'close', before);
            });

            it('⏸ stays waiting (not suspended) when the typed name could not be written', async () => {
                const timer = running(h.board, measure);
                h.results.flush = false;
                const before = h.persistedCount();

                await h.lifecycle.stop(timer, 'suspend');
                h.board.flush();

                expect(h.order).toEqual(['flush']);
                expectKept(timer, 'suspend', before);
            });
        });
    }

    it('■ again records the fixed run once, ended when it was first pressed', async () => {
        const timer = running(h.board);
        h.results.record = false;
        await h.lifecycle.stop(timer, 'close');

        // 失敗のあと時間が経っても、止まった時計は伸びない。
        vi.setSystemTime(T0 + 120_000);
        expect(readSeconds(timer.clock, Date.now())).toBe(600);

        h.results.record = true;
        await h.lifecycle.stop(timer, 'close');

        expect(h.records).toEqual([
            { endMs: T0, seconds: 600, then: 'close' },
            { endMs: T0, seconds: 600, then: 'close' },
        ]);
        expect(h.board.has(timer)).toBe(false);
    });

    it('⏸ again after a failed ⏸ records once and suspends, counting the run once', async () => {
        const timer = running(h.board);
        h.results.record = false;
        await h.lifecycle.stop(timer, 'suspend');

        vi.setSystemTime(T0 + 120_000);
        h.results.record = true;
        await h.lifecycle.stop(timer, 'suspend');

        expect(h.records.map(r => r.endMs)).toEqual([T0, T0]);
        expect(timer.session).toEqual({ kind: 'suspended' });
        expect(timer.recorded).toEqual({ seconds: 600, count: 1 });
    });

    it('the exit pressed last decides where it goes: ⏸ after a failed ■ suspends', async () => {
        const timer = running(h.board);
        h.results.record = false;
        await h.lifecycle.stop(timer, 'close');

        h.results.record = true;
        await h.lifecycle.stop(timer, 'suspend');

        expect(h.records.map(r => r.then)).toEqual(['close', 'suspend']);
        expect(timer.session).toEqual({ kind: 'suspended' });
        expect(h.board.has(timer)).toBe(true);
    });

    it('the last segment of a pomodoro filled: the record ends when it filled, not when the tick saw it', async () => {
        const timer = running(h.board, {
            type: 'interval', source: 'pomodoro', at: START_CURSOR,
            groups: [{ repeatCount: 1, segments: [{ label: 'Work', durationSeconds: 300, type: 'work' }] }],
        });
        h.results.record = false;

        h.lifecycle.tick(T0);
        await vi.waitFor(() => expect(h.runtime.busy.size).toBe(0));

        // 10 分前に始まり、5 分で満ちた。
        expect(h.records).toEqual([{ endMs: T0 - 300_000, seconds: 300, then: 'close' }]);
        expect(timer.session).toEqual({ kind: 'pending', record: { endMs: T0 - 300_000, seconds: 300, then: 'close' } });
        expect(h.board.has(timer)).toBe(true);
    });
});
