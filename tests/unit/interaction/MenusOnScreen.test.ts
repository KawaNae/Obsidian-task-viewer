import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    forgetMenus,
    menuShown,
    menusOnScreen,
    whenMenusGone,
    MENU_GONE_BOUND_MS,
    type MenusGone,
} from '../../../src/interaction/menu/MenusOnScreen';

/**
 * The plugin's menus on the screen, as a focus put on a field waits for
 * them: each one shown until told gone, a wait bounded at 700 ms from its
 * start, and a menu not told gone by then taken out.
 */

/** What a wait came to, read as the timers run: undefined while it waits. */
function watch(wait: Promise<MenusGone> | null): { how: MenusGone | undefined } {
    const seen: { how: MenusGone | undefined } = { how: undefined };
    void wait?.then((how) => { seen.how = how; });
    return seen;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    forgetMenus();
    vi.useRealTimers();
});

describe('MenusOnScreen', () => {
    it('answers null with no menu on the screen', () => {
        expect(whenMenusGone()).toBeNull();
        const gone = menuShown();
        gone();
        expect(whenMenusGone()).toBeNull();
    });

    it('settles as the menu is told gone', async () => {
        const gone = menuShown();
        const seen = watch(whenMenusGone());
        await vi.advanceTimersByTimeAsync(435);
        expect(seen.how).toBeUndefined();
        gone();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen.how).toBe('gone');
        expect(menusOnScreen()).toBe(0);
    });

    it('waits for every menu on the screen, the later shown too', async () => {
        const first = menuShown();
        const next = menuShown();
        const seen = watch(whenMenusGone());
        next();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen.how).toBeUndefined();
        first();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen.how).toBe('gone');
    });

    it('does not wait for a menu shown after the wait began', async () => {
        const first = menuShown();
        const seen = watch(whenMenusGone());
        menuShown();
        first();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen.how).toBe('gone');
    });

    it('settles at the bound, 700 ms from the wait\'s start, when the menu is not told gone', async () => {
        menuShown();
        await vi.advanceTimersByTimeAsync(5000);
        const seen = watch(whenMenusGone());
        await vi.advanceTimersByTimeAsync(MENU_GONE_BOUND_MS - 1);
        expect(seen.how).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(seen.how).toBe('bound');
    });

    it('takes out a menu at the bound: a later wait does not wait for it', async () => {
        const gone = menuShown();
        watch(whenMenusGone());
        await vi.advanceTimersByTimeAsync(MENU_GONE_BOUND_MS);
        expect(menusOnScreen()).toBe(0);
        expect(whenMenusGone()).toBeNull();
        gone();
        expect(whenMenusGone()).toBeNull();
    });

    it('lets a second wait for the same menu end with the first, at the first\'s bound', async () => {
        menuShown();
        const first = watch(whenMenusGone());
        await vi.advanceTimersByTimeAsync(300);
        const second = watch(whenMenusGone());
        await vi.advanceTimersByTimeAsync(MENU_GONE_BOUND_MS - 300);
        expect(first.how).toBe('bound');
        expect(second.how).toBe('bound');
    });

    it('tells a bound when one menu reached it and another was gone', async () => {
        const quick = menuShown();
        menuShown();
        const seen = watch(whenMenusGone());
        quick();
        await vi.advanceTimersByTimeAsync(MENU_GONE_BOUND_MS);
        expect(seen.how).toBe('bound');
    });

    it('does nothing told gone twice', () => {
        const gone = menuShown();
        gone();
        gone();
        expect(menusOnScreen()).toBe(0);
    });
});
