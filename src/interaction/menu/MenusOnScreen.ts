/**
 * The plugin's menus still on the screen: shown, and not yet gone.
 *
 * A menu told to close is not gone at once everywhere. On a phone's layout
 * (a window less than 600px wide or high) Obsidian shows it as a sheet that
 * slides away, and tells it has gone (`onHide`) once the slide has ended;
 * elsewhere it goes inside `hide()`. A field focused meanwhile raises the
 * on-screen keyboard, and the sheet still sliding away rises with it. So
 * the focus put on a field waits here for the menus to go
 * (`FocusPlacement`).
 *
 * Each menu shown is one entry with its own promise, so a menu shown after
 * another does not stand for it. A wait has a bound: a menu whose going is
 * not told within `MENU_GONE_BOUND_MS` of the first wait for it is let go of
 * (taken out), so a menu whose `onHide` never comes delays the focus once,
 * not on every later wait.
 *
 * DOM-free and module-scoped, as `OverlayRegistry` is: a plugin reload
 * re-evaluates the module.
 */

/** How long a wait for the menus to go lasts at most (ms): past a sheet's slide (about 0.45 s), and short of a pause the user would feel. */
export const MENU_GONE_BOUND_MS = 700;

/** How a wait for the menus ended: all of them gone, or one let go of at the bound. */
export type MenusGone = 'gone' | 'bound';

interface ShownMenu {
    /** Settles once the menu has gone, or at the bound. Made by the first wait. */
    settled: Promise<MenusGone> | null;
    settle: ((how: MenusGone) => void) | null;
    timer: ReturnType<typeof setTimeout> | null;
}

const shown = new Set<ShownMenu>();

/**
 * Tell a menu shown. Answers what tells it gone, as its `onHide` comes:
 * called again, or after the bound took the menu out, it does nothing.
 */
export function menuShown(): () => void {
    const menu: ShownMenu = { settled: null, settle: null, timer: null };
    shown.add(menu);
    return () => {
        if (!shown.delete(menu)) return;
        if (menu.timer !== null) clearTimeout(menu.timer);
        menu.settle?.('gone');
    };
}

/**
 * Settles once every menu on the screen now has gone, or the bound let one
 * go; null when none is on the screen, so the caller can act at once.
 */
export function whenMenusGone(): Promise<MenusGone> | null {
    if (shown.size === 0) return null;
    return Promise.all([...shown].map(settledOf))
        .then((hows) => (hows.includes('bound') ? 'bound' : 'gone'));
}

/** The menu's promise, its bound counted from the first wait for it. */
function settledOf(menu: ShownMenu): Promise<MenusGone> {
    if (menu.settled) return menu.settled;
    menu.settled = new Promise<MenusGone>((resolve) => { menu.settle = resolve; });
    menu.timer = setTimeout(() => {
        menu.timer = null;
        if (!shown.delete(menu)) return;
        menu.settle?.('bound');
    }, MENU_GONE_BOUND_MS);
    return menu.settled;
}

/** Menus on the screen. Tests only. */
export function menusOnScreen(): number {
    return shown.size;
}

/** Forget every menu, as gone. Tests only. */
export function forgetMenus(): void {
    const menus = [...shown];
    shown.clear();
    for (const menu of menus) {
        if (menu.timer !== null) clearTimeout(menu.timer);
        menu.settle?.('gone');
    }
}
