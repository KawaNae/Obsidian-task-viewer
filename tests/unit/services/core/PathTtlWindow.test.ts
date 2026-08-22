import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PathTtlWindow } from '../../../../src/services/core/PathTtlWindow';

/**
 * The suppression window the index uses twice: once to forget its own writes
 * (1000ms), once to hold off notifies while an API write is in flight (2000ms).
 *
 * What matters is when the mark goes away. A window that expires early lets a
 * self-write's late metadata event through and the view scans and repaints a
 * second time; one that never expires suppresses a real external edit.
 */
describe('PathTtlWindow', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('holds the mark for the TTL and not a tick longer', () => {
        const w = new PathTtlWindow(1000);
        w.mark('a.md');

        vi.advanceTimersByTime(999);
        expect(w.has('a.md')).toBe(true);

        vi.advanceTimersByTime(1);
        expect(w.has('a.md')).toBe(false);
    });

    it('re-marking restarts the window rather than keeping the first deadline', () => {
        const w = new PathTtlWindow(1000);
        w.mark('a.md');
        vi.advanceTimersByTime(900);
        w.mark('a.md');

        // Mutation: drop `clearTimeout(existing)` in mark() and the first
        // timer still fires here, dropping a mark that was just renewed.
        vi.advanceTimersByTime(500);
        expect(w.has('a.md')).toBe(true);

        vi.advanceTimersByTime(500);
        expect(w.has('a.md')).toBe(false);
    });

    it('keeps paths apart', () => {
        const w = new PathTtlWindow(1000);
        w.mark('a.md');
        vi.advanceTimersByTime(600);
        w.mark('b.md');

        vi.advanceTimersByTime(500);
        expect(w.has('a.md')).toBe(false);
        expect(w.has('b.md')).toBe(true);
    });

    it('clear() drops the mark without waiting', () => {
        const w = new PathTtlWindow(1000);
        w.mark('a.md');
        w.clear('a.md');
        expect(w.has('a.md')).toBe(false);

        // The cancelled timer must not resurface as a stray callback.
        expect(vi.getTimerCount()).toBe(0);
    });

    it('dispose() cancels every pending window', () => {
        const w = new PathTtlWindow(1000);
        w.mark('a.md');
        w.mark('b.md');
        w.dispose();

        // Mutation: leave dispose() clearing only the Map and the timers
        // survive — after unload they fire against a dead index.
        expect(vi.getTimerCount()).toBe(0);
        expect(w.has('a.md')).toBe(false);
        expect(w.has('b.md')).toBe(false);
    });
});
