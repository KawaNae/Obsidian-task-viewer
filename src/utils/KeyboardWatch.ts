/**
 * The on-screen keyboard of each window: where its top stands, and the
 * parts that follow it told as it moves.
 *
 * The keyboard is told two ways, and a window is listened to both ways
 * once, however many parts follow it:
 * - the visualViewport resizing and scrolling (Windows, Safari): it shrinks
 *   above the keyboard, and its top moves as it scrolls. Where its bottom
 *   stands is read when asked (`keyboardTop`)
 * - Capacitor's events on the window (`keyboardWillShow`, `keyboardDidShow`,
 *   `keyboardWillHide`, `keyboardDidHide`), on Obsidian mobile, where the
 *   WebView is not resized and the visualViewport never changes. The height
 *   a show carries is told only then, so it is kept as it comes
 *
 * On each of these, the height a show or a hide carries is kept first, and
 * the parts that follow the window (`watchKeyboard`) are told after, in the
 * order they began to: a part reading the keyboard's top as it is told
 * reads the height that event carried.
 *
 * The state is the module's, by window, so what places an element above
 * the keyboard (`positionElement`, the source editor's room for its
 * completions) reads it with no plugin at hand. The main window is listened
 * to from the plugin's load (`trackKeyboard`): a keyboard already up as an
 * overlay first opens is known. A popout window is listened to as it is
 * first used.
 */

import { logError } from '../log/log';

/** What the keyboard's state was told by: one of Capacitor's events, or the visualViewport. */
export type KeyboardCause =
    | 'keyboardWillShow'
    | 'keyboardDidShow'
    | 'keyboardWillHide'
    | 'keyboardDidHide'
    | 'viewportResize'
    | 'viewportScroll';

/** What a part following the keyboard is told. */
export interface KeyboardChange {
    readonly cause: KeyboardCause;
    /** The `keyboardHeight` Capacitor's event carried (px); none for the visualViewport, or an event that carried none. */
    readonly height: number | undefined;
}

export type KeyboardListener = (change: KeyboardChange) => void;

interface Follower {
    readonly fn: KeyboardListener;
    /** Cleared as it stops following, so a change being told skips it. */
    live: boolean;
}

interface Watched {
    followers: Follower[];
    stop: () => void;
}

/** Capacitor's events on the window, on Obsidian mobile. */
const KEYBOARD_EVENTS = ['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide'] as const;

const nativeHeights = new WeakMap<Window, number>();
const watched = new Map<Window, Watched>();

/** Listen to `win`'s keyboard, once for the window. */
function watch(win: Window): Watched {
    const existing = watched.get(win);
    if (existing) return existing;

    const w: Watched = { followers: [], stop: () => {} };

    // Those following as the change comes are told, in order; one that
    // stops while it is told is skipped, one that begins is told from the
    // next change, and one that throws leaves the rest told, as the DOM's
    // own listeners are.
    const tell = (change: KeyboardChange) => {
        for (const f of [...w.followers]) {
            if (!f.live) continue;
            try {
                f.fn(change);
            } catch (err) {
                // The plugin's log can be exported from the device, while the console cannot be seen there (iPad).
                const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
                logError(`[KeyboardWatch] a part following the keyboard failed: ${detail}`, { notice: false });
            }
        }
    };

    // The height a show carries is how much of the window the keyboard
    // covers, 0 where it covers none (on iPad, a window ending above the
    // keyboard, or moved above it while it is up): kept as no keyboard, so a
    // height told before does not outlive it. A show with no height keeps
    // what was told.
    const take = (cause: KeyboardCause, e: Event | undefined) => {
        const h = (e as (Event & { keyboardHeight?: number }) | undefined)?.keyboardHeight;
        if (cause === 'keyboardWillHide' || cause === 'keyboardDidHide') {
            nativeHeights.set(win, 0);
        } else if (typeof h === 'number' && h >= 0) {
            nativeHeights.set(win, h);
        }
        tell({ cause, height: h });
    };
    const onWin = KEYBOARD_EVENTS.map((type) => [type, (e?: Event) => take(type, e)] as const);
    const vv = win.visualViewport;
    const onVv = vv ? ([
        ['resize', () => tell({ cause: 'viewportResize', height: undefined })],
        ['scroll', () => tell({ cause: 'viewportScroll', height: undefined })],
    ] as const) : [];

    for (const [type, fn] of onWin) win.addEventListener(type, fn);
    for (const [type, fn] of onVv) vv?.addEventListener(type, fn);

    w.stop = () => {
        for (const [type, fn] of onWin) win.removeEventListener(type, fn);
        for (const [type, fn] of onVv) vv?.removeEventListener(type, fn);
        for (const f of w.followers) f.live = false;
        w.followers = [];
    };
    watched.set(win, w);
    return w;
}

/**
 * Follow `win`'s keyboard: `onChange` is told of each change, after the
 * keyboard's state has taken it. Listens to the window if nothing did yet.
 * @returns what stops following
 */
export function watchKeyboard(win: Window, onChange: KeyboardListener): () => void {
    const w = watch(win);
    const follower: Follower = { fn: onChange, live: true };
    w.followers.push(follower);
    return () => {
        if (!follower.live) return;
        follower.live = false;
        w.followers = w.followers.filter((f) => f !== follower);
    };
}

/**
 * For the tests alone: how many follow `win`'s keyboard, as its list holds
 * them. A part that stopped and is still in the list is counted: a skipped
 * one is not told, so only the count shows it left behind.
 */
export function keyboardFollowerCount(win: Window): number {
    return watched.get(win)?.followers.length ?? 0;
}

/** Listen to `win`'s keyboard with nothing following it yet, so its height is known when a part asks. */
export function trackKeyboard(win: Window): void {
    watch(win);
}

/** Stop listening to every window's keyboard (the plugin unloading): no part is told any more. */
export function untrackAllKeyboards(): void {
    for (const w of watched.values()) w.stop();
    watched.clear();
}

/** The keyboard's height Capacitor told last (px), 0 when closed or where it tells none. */
export function nativeKeyboardHeight(win: Window): number {
    return nativeHeights.get(win) ?? 0;
}

/**
 * The client Y of the keyboard's top: the higher of the two ways it is
 * told. The window's innerHeight with no keyboard.
 */
export function keyboardTop(win: Window): number {
    const vv = win.visualViewport;
    const vvTop = vv ? vv.offsetTop + vv.height : Infinity;
    const native = nativeHeights.get(win) ?? 0;
    const nativeTop = native > 0 ? win.innerHeight - native : Infinity;
    const top = Math.min(vvTop, nativeTop);
    return top === Infinity ? win.innerHeight : top;
}

/**
 * How much of the window the keyboard covers (whole px), from its top to the
 * window's bottom; 0 under 1px. The window's innerHeight is a whole number
 * and the visualViewport's height need not be (a zoom of the app), so what
 * is less than a pixel between them is no keyboard.
 */
export function keyboardOverlap(win: Window): number {
    const covered = win.innerHeight - keyboardTop(win);
    return covered >= 1 ? Math.round(covered) : 0;
}
