import { describe, it, expect, vi } from 'vitest';
import { TimerBoard } from '../../../src/timer/TimerBoard';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRuntime } from '../../../src/timer/TimerRuntime';
import type { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { freeze, restart } from '../../../src/timer/TimerClock';
import { holdsRun, newTimerId, type Session, type TimerState } from '../../../src/timer/TimerState';
import type { Measure } from '../../../src/timer/TimerProgress';

/**
 * The close item of the gear's menu (`TimerLifecycle.close(timer)`) decides
 * what it does from the session alone, when the press lands:
 *
 * - running or waiting to record … the note holds a running line. The timer is
 *   closed without recording, taking the running line it wrote with it. The
 *   same for a countdown past zero
 * - suspended                    … everything is recorded. The timer is only
 *   closed, and nothing is removed
 *
 * Like every operation it waits its turn: pressed while another write is on its
 * way, or on a timer already gone, it does nothing.
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};

function build() {
    const board = new TimerBoard({ persist: () => { }, render: () => { } });
    const runtime = new TimerRuntime();
    const discardRunningPlaceholder = vi.fn(async (_timer: TimerState) => { });
    const releaseAnchors = vi.fn(async (_timer: TimerState) => { });
    const recorder = { discardRunningPlaceholder, releaseAnchors } as unknown as TimerRecorder;
    const lifecycle = new TimerLifecycle({ board, runtime, recorder, renderTimes: () => { } });
    return { board, runtime, lifecycle, discardRunningPlaceholder, releaseAnchors };
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
        recorded: { seconds: 0, count: 0 }, priorStartMs: null, expanded: true,
    };
    board.add(timer);
    return timer;
}

const PENDING: Session = { kind: 'pending', record: { endMs: 0, seconds: 5, then: 'close' } };

describe('the close item throws a timer that holds a running line away with its line', () => {
    it('a running countup, and a countdown past zero, are closed with their running lines removed', async () => {
        const h = build();
        const countup = timerIn(h.board, { kind: 'running', from: 0 });
        const overrun = timerIn(h.board, { kind: 'running', from: 0 }, { type: 'countdown', totalSeconds: 60 }, 90);
        expect(holdsRun(countup)).toBe(true);
        expect(holdsRun(overrun)).toBe(true);

        await h.lifecycle.close(countup);
        await h.lifecycle.close(overrun);

        expect(h.board.size).toBe(0);
        expect(h.discardRunningPlaceholder.mock.calls).toEqual([[countup], [overrun]]);
        expect(h.releaseAnchors.mock.calls).toEqual([[countup], [overrun]]);
    });

    it('a run waiting for its record is thrown away with its line', async () => {
        const h = build();
        const timer = timerIn(h.board, PENDING);
        expect(holdsRun(timer)).toBe(true);

        await h.lifecycle.close(timer);

        expect(h.board.has(timer)).toBe(false);
        expect(h.discardRunningPlaceholder).toHaveBeenCalledWith(timer);
    });

    it('the line goes before the timer leaves the board', async () => {
        const h = build();
        const timer = timerIn(h.board, { kind: 'running', from: 0 });
        const onBoardWhenDiscarded: boolean[] = [];
        h.discardRunningPlaceholder.mockImplementation(async (t) => { onBoardWhenDiscarded.push(h.board.has(t)); });

        await h.lifecycle.close(timer);

        expect(onBoardWhenDiscarded).toEqual([true]);
        expect(h.board.has(timer)).toBe(false);
    });
});

describe('the close item only closes a suspended timer', () => {
    it('it has recorded everything: closed, nothing removed, its anchors released', async () => {
        const h = build();
        const timer = timerIn(h.board, { kind: 'suspended' });
        expect(holdsRun(timer)).toBe(false);

        await h.lifecycle.close(timer);

        expect(h.board.has(timer)).toBe(false);
        expect(h.discardRunningPlaceholder).not.toHaveBeenCalled();
        expect(h.releaseAnchors).toHaveBeenCalledWith(timer);
    });
});

describe('the close item waits its turn', () => {
    it('pressed while another operation of the timer is on its way, it does nothing, whatever the session', async () => {
        const h = build();
        for (const session of [{ kind: 'running', from: 0 } as Session, PENDING, { kind: 'suspended' } as Session]) {
            const timer = timerIn(h.board, session);
            h.runtime.busy.add(timer.id);

            await h.lifecycle.close(timer);

            expect(h.board.has(timer)).toBe(true);
        }
        expect(h.discardRunningPlaceholder).not.toHaveBeenCalled();
        expect(h.releaseAnchors).not.toHaveBeenCalled();
    });

    it('on a timer already gone from the board, it removes no line', async () => {
        const h = build();
        const timer = timerIn(h.board, { kind: 'running', from: 0 });
        h.board.remove(timer);

        await h.lifecycle.close(timer);

        expect(h.discardRunningPlaceholder).not.toHaveBeenCalled();
        expect(h.releaseAnchors).not.toHaveBeenCalled();
    });
});
