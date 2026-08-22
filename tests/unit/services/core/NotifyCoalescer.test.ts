import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotifyCoalescer } from '../../../../src/services/core/NotifyCoalescer';

/**
 * How a frame's worth of notifications becomes one.
 *
 * The rules were never testable on their own — they lived inside TaskIndex,
 * reachable only by driving vault events. They decide what a view is told it
 * may skip re-rendering, so getting them wrong is either a wasted full repaint
 * or, worse, a card left showing a value the store no longer holds.
 */
describe('NotifyCoalescer', () => {
    let emit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        emit = vi.fn();
    });
    afterEach(() => vi.useRealTimers());

    const make = () => new NotifyCoalescer(emit, 16);

    it('joins two spans for the same task into one emission', () => {
        const c = make();
        c.schedule('t1', ['startTime']);
        c.schedule('t1', ['endTime']);
        vi.advanceTimersByTime(16);

        // Mutation: make merge() overwrite instead of union the change set and
        // 'startTime' disappears — the view keeps a stale start.
        expect(emit).toHaveBeenCalledTimes(1);
        const [taskId, changes] = emit.mock.calls[0];
        expect(taskId).toBe('t1');
        expect(new Set(changes)).toEqual(new Set(['startTime', 'endTime']));
    });

    it('falls back to a full invalidation once a second task joins the frame', () => {
        const c = make();
        c.schedule('t1', ['startTime']);
        c.schedule('t2', ['endTime']);
        vi.advanceTimersByTime(16);

        // Mutation: let the later task win instead of demoting to 'full' and
        // t1's change is never announced.
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith();
    });

    it('a caller that cannot name a task invalidates everything', () => {
        const c = make();
        c.schedule();
        vi.advanceTimersByTime(16);

        expect(emit).toHaveBeenCalledWith();
    });

    it('does not climb back down from a full invalidation', () => {
        const c = make();
        c.schedule();
        c.schedule('t1', ['startTime']);
        vi.advanceTimersByTime(16);

        // Mutation: drop the `if (pending === 'full') return` guard and the
        // frame narrows to t1, so everything else silently stops refreshing.
        expect(emit).toHaveBeenCalledWith();
    });

    it('coalesces a burst into a single emission at the end of the quiet period', () => {
        const c = make();
        for (let i = 0; i < 5; i++) {
            c.schedule('t1', ['startTime']);
            vi.advanceTimersByTime(10);
        }
        expect(emit).not.toHaveBeenCalled();

        vi.advanceTimersByTime(16);
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('flushNow emits at once and cancels the pending wait', () => {
        const c = make();
        c.schedule('t1', ['startTime']);
        c.flushNow('t1', ['endTime']);

        expect(emit).toHaveBeenCalledTimes(1);
        expect(new Set(emit.mock.calls[0][1])).toEqual(new Set(['startTime', 'endTime']));

        // Mutation: leave the debounce timer running in flushNow(). The extra
        // emission it would cause is swallowed by the empty buffer, so the
        // count alone cannot see it — what is left behind is a timer, and a
        // timer left behind is what dispose() then has to guess about.
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(100);
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('flushNow with no arguments is itself a full invalidation', () => {
        const c = make();
        c.schedule('t1', ['startTime']);
        c.flushNow();

        // The drag path relies on this: it names no task and expects every
        // view to re-read the store, not just the one card it moved.
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith();
    });

    it('dispose() keeps a pending frame from firing after unload', () => {
        const c = make();
        c.schedule('t1', ['startTime']);
        c.dispose();

        // Mutation: drop the clearTimeout from dispose(). Asserting after the
        // clock has run cannot see it — the stray timer has already fired by
        // then and found an empty buffer. The disarming has to be checked at
        // the moment of dispose.
        expect(vi.getTimerCount()).toBe(0);

        vi.advanceTimersByTime(100);
        expect(emit).not.toHaveBeenCalled();
    });
});
