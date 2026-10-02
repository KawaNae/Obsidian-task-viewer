import { describe, it, expect, vi } from 'vitest';
import { TimerBoard } from '../../../src/timer/TimerBoard';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRuntime } from '../../../src/timer/TimerRuntime';
import type { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { freeze, restart } from '../../../src/timer/TimerClock';
import { holdsRun, newTimerId, type Session, type TimerState } from '../../../src/timer/TimerState';
import type { Measure } from '../../../src/timer/TimerProgress';

/**
 * ✕ の分かれ目は記録の区切り（`session.kind`）だけで決まる
 * （`TimerLifecycle.close(timer, confirmed)`）。
 *
 * - 走っているか記録待ち … ノートに走行中の行を持つ。確認の2打目で、自分で書いた
 *   走行中の行ごと捨てて閉じる。countdown が 0 を割っていても同じ
 * - 中断中             … 記録を書き終えている。確認なしで閉じ、何も消さない
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};

function build() {
    const board = new TimerBoard({ persist: () => { }, render: () => { } });
    const discardRunningPlaceholder = vi.fn(async (_timer: TimerState) => { });
    const releaseAnchors = vi.fn(async (_timer: TimerState) => { });
    const recorder = { discardRunningPlaceholder, releaseAnchors } as unknown as TimerRecorder;
    const content = { flush: vi.fn(async () => true), discard: vi.fn(), release: vi.fn() };
    const lifecycle = new TimerLifecycle({ board, runtime: new TimerRuntime(), recorder, content, renderTimes: () => { } });
    return { board, lifecycle, discardRunningPlaceholder, releaseAnchors, content };
}

function timerIn(board: TimerBoard, session: Session, measure: Measure = { type: 'countup' }, startedSecondsAgo = 90): TimerState {
    const now = Date.now();
    const clock = restart(now - startedSecondsAgo * 1000);
    const timer: TimerState = {
        id: newTimerId(),
        subject: { kind: 'task', anchor: 'box' },
        file: 'notes/a.md', name: 'A', color: '', mode: 'child',
        measure,
        clock: session.kind === 'running' ? clock : freeze(clock, now),
        session,
        tail: 'tv-tail', owned: ['tv-tail'], opening: null,
        recorded: { seconds: 0, count: 0 }, priorStartMs: null, draft: null, expanded: true,
    };
    board.add(timer);
    return timer;
}

const PENDING: Session = { kind: 'pending', record: { endMs: 0, seconds: 5, then: 'close' } };

describe('✕ asks first whenever the timer holds a running line', () => {
    it('a running timer holds its line, and so does a countdown past zero', () => {
        const h = build();
        const countup = timerIn(h.board, { kind: 'running', from: 0 });
        const overrun = timerIn(h.board, { kind: 'running', from: 0 }, { type: 'countdown', totalSeconds: 60 }, 90);
        expect(holdsRun(countup)).toBe(true);
        expect(holdsRun(overrun)).toBe(true);
        expect(h.lifecycle.close(countup, false)).toBe('confirm');
        expect(h.lifecycle.close(overrun, false)).toBe('confirm');
        expect(h.board.size).toBe(2);
    });

    it('a stopped run waiting for its record holds its line', () => {
        const h = build();
        const timer = timerIn(h.board, PENDING);
        expect(holdsRun(timer)).toBe(true);
        expect(h.lifecycle.close(timer, false)).toBe('confirm');
        expect(h.board.has(timer)).toBe(true);
    });

    it('a suspended timer has recorded everything and closes without asking, removing nothing', async () => {
        const h = build();
        const timer = timerIn(h.board, { kind: 'suspended' });
        expect(holdsRun(timer)).toBe(false);

        expect(h.lifecycle.close(timer, false)).toBe('closing');

        expect(h.board.has(timer)).toBe(false);
        expect(h.discardRunningPlaceholder).not.toHaveBeenCalled();
        // 付けた錨は後始末で外す。
        await vi.waitFor(() => expect(h.releaseAnchors).toHaveBeenCalledWith(timer));
    });

    it('confirmed, an overrunning countdown has its running line removed, then closes', async () => {
        const h = build();
        const timer = timerIn(h.board, { kind: 'running', from: 0 }, { type: 'countdown', totalSeconds: 60 }, 90);

        expect(h.lifecycle.close(timer, true)).toBe('closing');

        await vi.waitFor(() => expect(h.board.has(timer)).toBe(false));
        expect(h.content.discard).toHaveBeenCalledWith(timer);
        expect(h.discardRunningPlaceholder).toHaveBeenCalledWith(timer);
    });

    it('confirmed, a run waiting for its record is thrown away with its line', async () => {
        const h = build();
        const timer = timerIn(h.board, PENDING);

        expect(h.lifecycle.close(timer, true)).toBe('closing');

        await vi.waitFor(() => expect(h.board.has(timer)).toBe(false));
        expect(h.discardRunningPlaceholder).toHaveBeenCalledWith(timer);
    });
});
