import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bindTapIntents } from '../../../src/interaction/tap/TapIntent';

/**
 * Vitest is configured with `environment: 'node'`, so we shim the small
 * surface that bindTapIntents touches (addEventListener / removeEventListener
 * + `e.target` + `e.preventDefault()`). This keeps the test independent of
 * jsdom and stays consistent with how other tests in this repo handle DOM.
 */
function makeElement() {
    const listeners = new Map<string, Set<(e: any) => void>>();
    const el = {
        addEventListener(type: string, fn: (e: any) => void) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(fn);
        },
        removeEventListener(type: string, fn: (e: any) => void) {
            listeners.get(type)?.delete(fn);
        },
        listenerCount(type: string) {
            return listeners.get(type)?.size ?? 0;
        },
        dispatchClick(target: { closest?: (sel: string) => unknown } = {}) {
            const ev = {
                target,
                preventDefault: vi.fn(),
            };
            for (const fn of listeners.get('click') ?? []) fn(ev);
            return ev;
        },
    };
    return el as unknown as HTMLElement & {
        listenerCount: (type: string) => number;
        dispatchClick: (target?: { closest?: (sel: string) => unknown }) => { preventDefault: () => void };
    };
}

describe('bindTapIntents', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Date.now should align with vitest fake timer tick so we can advance
        // beyond / within the dbltap threshold deterministically.
        vi.setSystemTime(new Date(0));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not fire onDoubleTap on a single click', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        bindTapIntents(el, { onDoubleTap });
        el.dispatchClick();
        expect(onDoubleTap).not.toHaveBeenCalled();
    });

    it('fires onDoubleTap exactly once for two clicks within threshold', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        bindTapIntents(el, { onDoubleTap });
        el.dispatchClick();
        vi.advanceTimersByTime(100);
        el.dispatchClick();
        expect(onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it('does not fire onDoubleTap when the second click is past the threshold', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        bindTapIntents(el, { onDoubleTap, threshold: 400 });
        el.dispatchClick();
        vi.advanceTimersByTime(500);
        el.dispatchClick();
        expect(onDoubleTap).not.toHaveBeenCalled();
    });

    it('respects custom threshold', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        bindTapIntents(el, { onDoubleTap, threshold: 200 });
        el.dispatchClick();
        vi.advanceTimersByTime(150);
        el.dispatchClick();
        expect(onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it('resets after a successful double-tap (3rd click does not fire again)', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        bindTapIntents(el, { onDoubleTap });
        el.dispatchClick();
        vi.advanceTimersByTime(50);
        el.dispatchClick(); // 2nd → fires
        vi.advanceTimersByTime(50);
        el.dispatchClick(); // 3rd → should NOT fire (counter reset)
        expect(onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it('skips clicks rejected by targetFilter without advancing the counter', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        const link = { closest: (sel: string) => (sel === 'a' ? {} : null) };
        const card = { closest: (_sel: string) => null };
        bindTapIntents(el, { onDoubleTap }, {
            targetFilter: (t) => !(t as any).closest('a'),
        });

        el.dispatchClick(link);     // ignored (no counter advance)
        vi.advanceTimersByTime(50);
        el.dispatchClick(card);     // 1st valid
        vi.advanceTimersByTime(50);
        el.dispatchClick(card);     // 2nd valid → fires
        expect(onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it('calls preventDefault on the 2nd click to suppress browser text selection', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        bindTapIntents(el, { onDoubleTap });
        const ev1 = el.dispatchClick();
        vi.advanceTimersByTime(50);
        const ev2 = el.dispatchClick();
        expect(ev1.preventDefault).not.toHaveBeenCalled();
        expect(ev2.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('returned unbind removes the listener', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        const unbind = bindTapIntents(el, { onDoubleTap });
        expect(el.listenerCount('click')).toBe(1);
        unbind();
        expect(el.listenerCount('click')).toBe(0);
        el.dispatchClick();
        vi.advanceTimersByTime(50);
        el.dispatchClick();
        expect(onDoubleTap).not.toHaveBeenCalled();
    });

    it('registers cleanup with the provided component', () => {
        const el = makeElement();
        const onDoubleTap = vi.fn();
        const registered: Array<() => void> = [];
        const component = { register: (cb: () => void) => registered.push(cb) } as unknown as import('obsidian').Component;
        bindTapIntents(el, { onDoubleTap }, { component });
        expect(registered.length).toBe(1);
        // Simulate component.unload() running its registered cleanups.
        registered[0]();
        expect(el.listenerCount('click')).toBe(0);
    });
});
