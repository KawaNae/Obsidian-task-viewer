import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { KeyboardAwareContainer } from '../../../src/utils/KeyboardAwareContainer';
import { untrackAllKeyboards } from '../../../src/utils/KeyboardState';

/**
 * KeyboardAwareContainer's `activeInput()`/focus handler do
 * `instanceof HTMLInputElement` / `instanceof HTMLTextAreaElement` checks.
 * Vitest's `node` environment has no DOM, so those globals don't exist —
 * defining them only for this file (restored in afterAll) avoids touching
 * the shared vitest setup or any other test file.
 */
class MockInputElement {}
class MockTextAreaElement {}
let savedHTMLInputElement: unknown;
let savedHTMLTextAreaElement: unknown;

beforeAll(() => {
    savedHTMLInputElement = (globalThis as any).HTMLInputElement;
    savedHTMLTextAreaElement = (globalThis as any).HTMLTextAreaElement;
    (globalThis as any).HTMLInputElement = MockInputElement;
    (globalThis as any).HTMLTextAreaElement = MockTextAreaElement;
});
afterAll(() => {
    (globalThis as any).HTMLInputElement = savedHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = savedHTMLTextAreaElement;
});

// --- Minimal DOM shims (plain-object pattern, mirrors ScheduleGridRenderer.test.ts) ---

class MiniEventTarget {
    private listeners = new Map<string, Set<(e?: any) => void>>();
    addEventListener(type: string, fn: (e?: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: (e?: any) => void) {
        this.listeners.get(type)?.delete(fn);
    }
    listenerCount(type: string): number {
        return this.listeners.get(type)?.size ?? 0;
    }
    dispatch(type: string, e?: any) {
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    }
}

class MockPanel extends MiniEventTarget {
    style: { height: string; paddingBottom: string } = { height: '', paddingBottom: '' };
    scrollTop = 0;
    rectHeight = 400;
    computedPaddingBottom = 0;
    lastScrollBy: { top: number } | null = null;
    lastScrollTo: { top: number } | null = null;
    getBoundingClientRect() { return { height: this.rectHeight, bottom: 0, top: 0 } as DOMRect; }
    scrollBy(opts: { top: number; behavior?: string }) { this.scrollTop += opts.top; this.lastScrollBy = opts; }
    scrollTo(opts: { top: number; behavior?: string }) { this.scrollTop = opts.top; this.lastScrollTo = opts; }
}

class MockInput extends MockInputElement {
    bottom: number;
    constructor(bottom: number) { super(); this.bottom = bottom; }
    getBoundingClientRect() { return { bottom: this.bottom, top: 0, height: 0 } as DOMRect; }
}

class MockVisualViewport extends MiniEventTarget {
    height: number;
    offsetTop: number;
    constructor(height: number, offsetTop = 0) { super(); this.height = height; this.offsetTop = offsetTop; }
}

class MockContainer extends MiniEventTarget {
    ownerDocument: { activeElement: any } = { activeElement: null };
    private children = new Set<any>();
    adopt(el: any) { this.children.add(el); }
    contains(el: any) { return this.children.has(el); }
}

class MockWindow extends MiniEventTarget {
    innerHeight = 800;
    visualViewport: MockVisualViewport | undefined;
    getComputedStyle(panel: MockPanel) {
        return { paddingBottom: `${panel.computedPaddingBottom}px` } as CSSStyleDeclaration;
    }
}

function setup(opts: { withVisualViewport?: boolean; vvHeight?: number } = {}) {
    const win = new MockWindow();
    if (opts.withVisualViewport !== false) {
        win.visualViewport = new MockVisualViewport(opts.vvHeight ?? win.innerHeight);
    }
    const container = new MockContainer();
    const panel = new MockPanel();
    const kac = new KeyboardAwareContainer(container as any, win as any);
    kac.scrollTarget = panel as any;
    return { win, container, panel, kac };
}

describe('KeyboardAwareContainer', () => {
    afterEach(() => {
        untrackAllKeyboards(); // KeyboardState's tracked-window map is not GC'd between tests
        vi.useRealTimers();
    });

    describe('visualViewport-based detection', () => {
        it('scrolls the panel and injects padding when the keyboard covers the focused input', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750); // near the bottom of an 800px-tall screen
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500; // 300px keyboard
            win.visualViewport!.dispatch('resize');

            // keyboardTop = offsetTop(0) + height(500) = 500; overshoot = 750 - 500 + 10 = 260
            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
            expect(panel.style.paddingBottom).toBe('260px');
            expect(panel.style.height).toBe('400px'); // locked at rectHeight captured on first correction
        });

        it('does nothing when the focused input does not overlap the keyboard', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(100); // well above where the keyboard will sit
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toBeNull();
            expect(panel.style.paddingBottom).toBe('');
        });

        it('does not treat a small viewport shrink (<=50px) as the keyboard opening', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 750; // exactly 50px shrink — boundary, not open
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toBeNull();
        });

        it('treats a >50px shrink as the keyboard opening', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 749; // 51px shrink — just over the threshold
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).not.toBeNull();
        });

        it('restores height/padding/scrollTop when the keyboard closes', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.style.height = 'auto';
            panel.style.paddingBottom = '8px';
            panel.scrollTop = 5;
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // opens, saves 'auto'/'8px'/5 as the pre-correction snapshot

            win.visualViewport!.height = 800;
            win.visualViewport!.dispatch('resize'); // closes

            expect(panel.style.height).toBe('auto');
            expect(panel.style.paddingBottom).toBe('8px');
            expect(panel.lastScrollTo).toEqual({ top: 5, behavior: 'instant' });
        });

        it('accumulates extraPad across repeated corrections without re-locking the panel height', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500; // overshoot 260, extraPad=260
            win.visualViewport!.dispatch('resize');
            const heightAfterFirst = panel.style.height;

            input.bottom = 900; // input moved further down (e.g. new field below)
            win.visualViewport!.dispatch('resize'); // same vv.height, re-evaluates via scroll listener path too — trigger via resize again

            // second correction should add on top of the first, not reset it
            expect(panel.style.height).toBe(heightAfterFirst); // height stays locked, not recomputed
        });
    });

    describe('native (Capacitor) keyboard events', () => {
        it('opens on keyboardWillShow with a keyboardHeight and reacts even with no visualViewport', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });

            // keyboardTop = innerHeight(800) - native(300) = 500; overshoot = 750-500+10=260
            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
        });

        it('closes and restores on keyboardWillHide', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollTop = 3;
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });
            win.dispatch('keyboardWillHide');

            expect(panel.lastScrollTo).toEqual({ top: 3, behavior: 'instant' });
        });
    });

    describe('focus/blur debouncing', () => {
        beforeEach(() => vi.useFakeTimers());

        it('re-corrects for a newly focused input while the keyboard is already open (after the 50ms debounce)', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const inputA = new MockInput(200); // does not overlap
            const inputB = new MockInput(750); // overlaps
            container.adopt(inputA);
            container.adopt(inputB);
            container.ownerDocument.activeElement = inputA;
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // keyboard opens, inputA doesn't need correction
            expect(panel.lastScrollBy).toBeNull();

            container.ownerDocument.activeElement = inputB;
            container.dispatch('focusin', { target: inputB });
            vi.advanceTimersByTime(50);

            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
        });

        it('restores 200ms after focus leaves the container with no input focused', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // opens + corrects

            container.ownerDocument.activeElement = null;
            container.dispatch('focusout');
            vi.advanceTimersByTime(200);

            expect(panel.style.height).toBe(''); // restored to the pre-correction empty string
        });

        it('does not restore on focusout if focus moved to another input inside the container', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const inputA = new MockInput(750);
            const inputB = new MockInput(750);
            container.adopt(inputA);
            container.adopt(inputB);
            container.ownerDocument.activeElement = inputA;
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');
            const lockedHeight = panel.style.height;

            container.ownerDocument.activeElement = inputB; // focus moved before the blur timer fires
            container.dispatch('focusout');
            vi.advanceTimersByTime(200);

            expect(panel.style.height).toBe(lockedHeight); // still corrected, not restored
        });
    });

    describe('detach', () => {
        it('stops reacting to visualViewport/native events and restores state', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');
            expect(panel.style.height).not.toBe('');

            kac.detach();

            expect(panel.style.height).toBe(''); // restore() ran as part of detach
            expect(kac.scrollTarget).toBeNull();

            // Further events must not reach the (now-detached) handlers.
            panel.lastScrollBy = null;
            win.visualViewport!.height = 300;
            win.visualViewport!.dispatch('resize');
            expect(panel.lastScrollBy).toBeNull();
        });

        it('removes every listener it registered in attach()', () => {
            const { win, container, kac } = setup({ vvHeight: 800 });
            kac.attach();
            expect(win.visualViewport!.listenerCount('resize')).toBe(1);
            // 2, not 1: KeyboardState.trackKeyboard() (called from attach()) adds its
            // own resident listener on the same event, independent of kbHandler.
            expect(win.listenerCount('keyboardWillShow')).toBe(2);
            expect(container.listenerCount('focusin')).toBe(1);
            expect(container.listenerCount('focusout')).toBe(1);

            kac.detach();

            expect(win.visualViewport!.listenerCount('resize')).toBe(0);
            // detach() only removes KeyboardAwareContainer's own kbHandler — trackKeyboard's
            // listener is process-lifetime (removed only via untrackAllKeyboards()).
            expect(win.listenerCount('keyboardWillShow')).toBe(1);
            expect(container.listenerCount('focusin')).toBe(0);
            expect(container.listenerCount('focusout')).toBe(0);
        });
    });
});
