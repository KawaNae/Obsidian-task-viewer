import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINUTE_MS, startMinuteClock, type ClockOwner } from '../../../src/views/sharedLogic/MinuteClock';

/** An owner that keeps what it was given to stop, and stops it on unload as a Component does. */
function owner() {
    const cleanups: (() => void)[] = [];
    const o: ClockOwner & { unload(): void } = {
        register: (cb) => { cleanups.push(cb); },
        registerInterval: (id) => { cleanups.push(() => window.clearInterval(id)); return id; },
        unload: () => cleanups.splice(0).forEach(cb => cb()),
    };
    return o;
}

describe('startMinuteClock', () => {
    beforeEach(() => {
        vi.stubGlobal('window', globalThis);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-03T09:15:40.000'));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('ticks first on the next minute boundary, then every minute', () => {
        const tick = vi.fn();
        startMinuteClock(owner(), tick);

        vi.advanceTimersByTime(19_999);
        expect(tick).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(tick).toHaveBeenCalledTimes(1);
        expect(new Date().getSeconds()).toBe(0);

        vi.advanceTimersByTime(MINUTE_MS);
        expect(tick).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(3 * MINUTE_MS);
        expect(tick).toHaveBeenCalledTimes(5);
    });

    it('stops with its owner, also before its first tick', () => {
        const tick = vi.fn();
        const o = owner();
        startMinuteClock(o, tick);

        o.unload();
        vi.advanceTimersByTime(5 * MINUTE_MS);
        expect(tick).not.toHaveBeenCalled();
    });

    it('stops with its owner after it has started ticking', () => {
        const tick = vi.fn();
        const o = owner();
        startMinuteClock(o, tick);
        vi.advanceTimersByTime(20_000 + MINUTE_MS);
        expect(tick).toHaveBeenCalledTimes(2);

        o.unload();
        vi.advanceTimersByTime(5 * MINUTE_MS);
        expect(tick).toHaveBeenCalledTimes(2);
    });
});
