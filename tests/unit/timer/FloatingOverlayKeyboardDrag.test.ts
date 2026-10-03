import { describe, it, expect, afterEach } from 'vitest';
import { FloatingOverlayHost } from '../../../src/timer/FloatingOverlayHost';
import { untrackAllKeyboards } from '../../../src/utils/KeyboardState';

/**
 * The widget is lifted above the on-screen keyboard by a drawn translateY.
 * A drag that starts while it is lifted must move it from where it is seen
 * and leave it where it is let go: before, the drop was checked against the
 * keyboard at the unlifted position and lifted again onto the keyboard's top.
 *
 * Vitest runs in `node` with no DOM, so the window, its visualViewport and the
 * container are plain-object shims (the pattern of KeyboardAwareContainer.test.ts).
 */

class MiniEventTarget {
    private listeners = new Map<string, Set<(e?: any) => void>>();
    addEventListener(type: string, fn: (e?: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: (e?: any) => void) {
        this.listeners.get(type)?.delete(fn);
    }
    dispatch(type: string, e?: any) {
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    }
}

const WIN_W = 1000;
const WIN_H = 800;
const W = 200;
const H = 100;

class MockVisualViewport extends MiniEventTarget {
    offsetTop = 0;
    constructor(public height: number) { super(); }
}

class MockWindow extends MiniEventTarget {
    innerWidth = WIN_W;
    innerHeight = WIN_H;
    visualViewport = new MockVisualViewport(WIN_H);
    requestAnimationFrame(fn: () => void) { fn(); return 0; }
}

/**
 * Lays itself out as the stylesheet and the inline style say: left/top when
 * set, else the bottom-right corner 16px in, then the translateY drawn on top.
 */
class MockContainer extends MiniEventTarget {
    style = { left: '', top: '', right: '', bottom: '', transform: '', cursor: '' };
    remove() {}
    setPointerCapture() {}
    releasePointerCapture() {}
    getBoundingClientRect(): DOMRect {
        const left = this.style.left ? parseFloat(this.style.left) : WIN_W - W - 16;
        const layoutTop = this.style.top ? parseFloat(this.style.top) : WIN_H - H - 16;
        const m = /translateY\((-?[\d.]+)px\)/.exec(this.style.transform);
        const top = layoutTop + (m ? parseFloat(m[1]) : 0);
        return { left, top, right: left + W, bottom: top + H, width: W, height: H } as DOMRect;
    }
}

function setup() {
    const win = new MockWindow();
    const container = new MockContainer();
    const doc = { body: { createDiv: () => container } };
    const host = new FloatingOverlayHost({ nonDraggableSelectors: ['input'] });
    host.attach(win as unknown as Window, doc as unknown as Document, 'timer-widget');
    return { win, container };
}

function setKeyboard(win: MockWindow, height: number) {
    win.visualViewport.height = WIN_H - height;
    win.visualViewport.dispatch('resize');
}

function pointer(container: MockContainer, type: string, x: number, y: number) {
    container.dispatch(type, { button: 0, pointerId: 1, clientX: x, clientY: y, target: { closest: () => null } });
}

afterEach(() => {
    untrackAllKeyboards();
});

describe('FloatingOverlayHost: dragging while the keyboard lifts the widget', () => {
    it('lifts the widget so its bottom sits above the keyboard', () => {
        const { win, container } = setup();
        setKeyboard(win, 400);
        expect(container.getBoundingClientRect().bottom).toBe(WIN_H - 400 - 8);
    });

    it('leaves the widget where it is let go above the keyboard, also after the keyboard closes', () => {
        const { win, container } = setup();
        setKeyboard(win, 400);
        const lifted = container.getBoundingClientRect();
        expect(lifted.top).toBe(292);

        // Grab 8px below the widget's seen top and drop it 150px higher: well
        // above the keyboard, yet within the lift of its unlifted place.
        pointer(container, 'pointerdown', 900, 300);
        pointer(container, 'pointermove', 900, 200);
        expect(container.getBoundingClientRect().top).toBe(192);
        pointer(container, 'pointermove', 900, 150);
        pointer(container, 'pointerup', 900, 150);

        const dropped = container.getBoundingClientRect();
        expect(dropped.top).toBe(142);
        expect(dropped.left).toBe(lifted.left);
        expect(container.style.transform).toBe('');

        setKeyboard(win, 0);
        expect(container.getBoundingClientRect().top).toBe(142);
    });

    it('lifts a widget dropped onto the keyboard back above it', () => {
        const { win, container } = setup();
        setKeyboard(win, 400);
        pointer(container, 'pointerdown', 900, 300);
        pointer(container, 'pointermove', 900, 450);
        pointer(container, 'pointerup', 900, 450);
        expect(container.getBoundingClientRect().bottom).toBe(WIN_H - 400 - 8);
    });

    it('does not move the widget on a press that is not dragged, and drops the lift when the keyboard closes', () => {
        const { win, container } = setup();
        setKeyboard(win, 400);
        pointer(container, 'pointerdown', 900, 300);
        pointer(container, 'pointermove', 902, 302);
        pointer(container, 'pointerup', 902, 302);

        expect(container.style.left).toBe('');
        expect(container.style.top).toBe('');
        expect(container.getBoundingClientRect().top).toBe(292);

        setKeyboard(win, 0);
        expect(container.getBoundingClientRect().top).toBe(WIN_H - H - 16);
    });
});
