import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    trackKeyboard, untrackAllKeyboards, nativeKeyboardHeight, keyboardTop, keyboardOverlap, watchKeyboard,
    keyboardFollowerCount, type KeyboardChange,
} from '../../../src/utils/KeyboardWatch';
import { clearLog, getLogEntries } from '../../../src/log/log';

function makeTarget() {
    const listeners = new Map<string, ((e: Event) => void)[]>();
    return {
        listenerCount: (type: string) => listeners.get(type)?.length ?? 0,
        addEventListener(type: string, fn: (e: Event) => void) {
            listeners.set(type, [...(listeners.get(type) ?? []), fn]);
        },
        removeEventListener(type: string, fn: (e: Event) => void) {
            listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
        },
        fire(type: string) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn({ type } as unknown as Event);
        },
    };
}

/** A window with a visualViewport: the keyboard told by it shrinking, on Windows and Safari. */
function makeViewportWindow() {
    const vv = Object.assign(makeTarget(), { height: 800, offsetTop: 0 });
    return Object.assign(makeTarget(), { innerHeight: 800, visualViewport: vv });
}

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

describe('KeyboardWatch: the height Capacitor tells', () => {
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

describe('KeyboardWatch: the parts following a window\'s keyboard', () => {
    afterEach(() => untrackAllKeyboards());

    it('tells them in the order they began to follow, each reading the height the event carried', () => {
        const win = makeWindow();
        const told: string[] = [];
        watchKeyboard(win as unknown as Window, (c) => told.push(`a ${c.cause} ${c.height} top=${keyboardTop(win as unknown as Window)}`));
        watchKeyboard(win as unknown as Window, (c) => told.push(`b ${c.cause} ${c.height} top=${keyboardTop(win as unknown as Window)}`));

        win.fire('keyboardWillShow', 340);
        win.fire('keyboardDidHide');

        expect(told).toEqual([
            'a keyboardWillShow 340 top=793',
            'b keyboardWillShow 340 top=793',
            'a keyboardDidHide undefined top=1133',
            'b keyboardDidHide undefined top=1133',
        ]);
    });

    it('listens to a window once, however many parts follow it', () => {
        const win = makeViewportWindow();
        trackKeyboard(win as unknown as Window);
        watchKeyboard(win as unknown as Window, () => {});
        watchKeyboard(win as unknown as Window, () => {});

        expect(win.listenerCount('keyboardWillShow')).toBe(1);
        expect(win.visualViewport.listenerCount('resize')).toBe(1);
        expect(win.visualViewport.listenerCount('scroll')).toBe(1);
    });

    it('tells of the visualViewport resizing and scrolling, the keyboard\'s top read from it', () => {
        const win = makeViewportWindow();
        const told: KeyboardChange[] = [];
        const overlaps: number[] = [];
        watchKeyboard(win as unknown as Window, (c) => {
            told.push(c);
            overlaps.push(keyboardOverlap(win as unknown as Window));
        });

        win.visualViewport.height = 500;
        win.visualViewport.fire('resize');
        win.visualViewport.offsetTop = 100;
        win.visualViewport.fire('scroll');

        expect(told).toEqual([
            { cause: 'viewportResize', height: undefined },
            { cause: 'viewportScroll', height: undefined },
        ]);
        expect(overlaps).toEqual([300, 200]);
    });

    it('reads what is less than a pixel between the window and the viewport as no overlap, and a pixel as one', () => {
        const win = makeViewportWindow();

        win.visualViewport.height = 799.4;
        expect(keyboardOverlap(win as unknown as Window)).toBe(0);

        win.visualViewport.height = 799;
        expect(keyboardOverlap(win as unknown as Window)).toBe(1);

        win.visualViewport.height = 500.4;
        expect(keyboardOverlap(win as unknown as Window)).toBe(300);
    });

    it('rounds what the keyboard covers to the nearest whole px, neither up nor down alone', () => {
        const win = makeViewportWindow();

        // 299.4px covered: 299, where rounding up would give 300.
        win.visualViewport.height = 500.6;
        expect(keyboardOverlap(win as unknown as Window)).toBe(299);

        // 299.6px covered: 300, where rounding down would give 299.
        win.visualViewport.height = 500.4;
        expect(keyboardOverlap(win as unknown as Window)).toBe(300);
    });

    it('tells each show, however often the same height is told again', () => {
        const win = makeWindow();
        const told: string[] = [];
        watchKeyboard(win as unknown as Window, (c) => told.push(`${c.cause} ${c.height}`));

        win.fire('keyboardWillShow', 340);
        win.fire('keyboardDidShow', 340);
        win.fire('keyboardDidShow', 340);

        expect(told).toEqual(['keyboardWillShow 340', 'keyboardDidShow 340', 'keyboardDidShow 340']);
    });

    it('tells no part that stopped following while the change was being told, and a part that began only from the next change', () => {
        const win = makeWindow();
        const told: string[] = [];
        let stopB = () => {};
        watchKeyboard(win as unknown as Window, (c) => {
            told.push(`a ${c.cause}`);
            stopB();
            watchKeyboard(win as unknown as Window, (d) => told.push(`c ${d.cause}`));
        });
        stopB = watchKeyboard(win as unknown as Window, (c) => told.push(`b ${c.cause}`));

        win.fire('keyboardWillShow', 340);

        expect(told).toEqual(['a keyboardWillShow']);
        told.length = 0;
        win.fire('keyboardDidShow', 340);
        expect(told).toEqual(['a keyboardDidShow', 'c keyboardDidShow']);
    });

    it('tells the rest when one part throws, the failure written to the plugin\'s log', () => {
        const win = makeWindow();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        clearLog();
        const told: string[] = [];
        watchKeyboard(win as unknown as Window, () => { throw new Error('broken'); });
        watchKeyboard(win as unknown as Window, (c) => told.push(c.cause));

        win.fire('keyboardWillShow', 340);

        expect(told).toEqual(['keyboardWillShow']);
        const failures = getLogEntries().filter((e) => e.level === 'error');
        expect(failures).toHaveLength(1);
        expect(failures[0].message).toContain('broken');
        error.mockRestore();
        clearLog();
    });

    it('tells no part once it stops following', () => {
        const win = makeWindow();
        const told: string[] = [];
        const stop = watchKeyboard(win as unknown as Window, (c) => told.push(c.cause));

        stop();
        stop();
        win.fire('keyboardWillShow', 340);

        expect(told).toEqual([]);
        expect(nativeKeyboardHeight(win as unknown as Window)).toBe(340);
    });

    it('lets go of a part once it stops following, the window keeping none of those that stopped', () => {
        const win = makeWindow();
        const stops = [1, 2, 3].map(() => watchKeyboard(win as unknown as Window, () => {}));
        expect(keyboardFollowerCount(win as unknown as Window)).toBe(3);

        stops[1]();
        expect(keyboardFollowerCount(win as unknown as Window)).toBe(2);
        stops[0]();
        stops[2]();

        expect(keyboardFollowerCount(win as unknown as Window)).toBe(0);
    });

    it('tells no part once every window is no longer listened to, its listeners taken off', () => {
        const win = makeViewportWindow();
        const told: string[] = [];
        const stop = watchKeyboard(win as unknown as Window, (c) => told.push(c.cause));

        untrackAllKeyboards();
        win.fire('keyboardWillShow');
        win.visualViewport.fire('resize');
        win.visualViewport.fire('scroll');
        stop();

        expect(told).toEqual([]);
        expect(win.listenerCount('keyboardWillShow')).toBe(0);
        expect(win.visualViewport.listenerCount('resize')).toBe(0);
        expect(win.visualViewport.listenerCount('scroll')).toBe(0);
    });

    it('listens to a window again for a part following it after every window was let go', () => {
        const win = makeWindow();
        const told: string[] = [];
        watchKeyboard(win as unknown as Window, (c) => told.push(`old ${c.cause}`));
        untrackAllKeyboards();

        watchKeyboard(win as unknown as Window, (c) => told.push(`new ${c.cause}`));
        win.fire('keyboardWillShow', 300);

        expect(told).toEqual(['new keyboardWillShow']);
        expect(nativeKeyboardHeight(win as unknown as Window)).toBe(300);
    });
});
