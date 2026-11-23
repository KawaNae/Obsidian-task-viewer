import { describe, it, expect, afterEach } from 'vitest';
import { trackKeyboard, untrackAllKeyboards, nativeKeyboardHeight, keyboardTop } from '../../../src/utils/KeyboardState';

/** A window with no visualViewport: the keyboard is told only by Capacitor's events. */
function makeWindow() {
    const listeners = new Map<string, ((e: Event) => void)[]>();
    return {
        innerHeight: 1133,
        visualViewport: undefined,
        addEventListener(type: string, fn: (e: Event) => void) {
            listeners.set(type, [...(listeners.get(type) ?? []), fn]);
        },
        removeEventListener(type: string, fn: (e: Event) => void) {
            listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
        },
        fire(type: string, keyboardHeight?: number) {
            const e = { type, ...(keyboardHeight === undefined ? {} : { keyboardHeight }) } as unknown as Event;
            for (const fn of listeners.get(type) ?? []) fn(e);
        },
    };
}

describe('KeyboardState: the height Capacitor tells', () => {
    afterEach(() => untrackAllKeyboards());

    it('keeps the height a show tells', () => {
        const win = makeWindow();
        trackKeyboard(win as unknown as Window);

        win.fire('keyboardDidShow', 340);

        expect(nativeKeyboardHeight(win as unknown as Window)).toBe(340);
        expect(keyboardTop(win as unknown as Window)).toBe(1133 - 340);
    });

    it('reads a show of height 0 as no keyboard over the window, a height told before not outliving it', () => {
        const win = makeWindow();
        trackKeyboard(win as unknown as Window);

        win.fire('keyboardDidShow', 340);
        win.fire('keyboardDidShow', 0); // the window moved above the keyboard

        expect(nativeKeyboardHeight(win as unknown as Window)).toBe(0);
        expect(keyboardTop(win as unknown as Window)).toBe(1133);
    });

    it('keeps what was told on a show that tells no height', () => {
        const win = makeWindow();
        trackKeyboard(win as unknown as Window);

        win.fire('keyboardWillShow', 340);
        win.fire('keyboardDidShow');

        expect(nativeKeyboardHeight(win as unknown as Window)).toBe(340);
    });
});
