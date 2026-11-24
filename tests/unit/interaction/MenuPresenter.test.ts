import { describe, it, expect, vi, afterEach } from 'vitest';
import { Menu } from '../mocks/obsidian';
import { MenuPresenter, type MenuAnchor } from '../../../src/interaction/menu/MenuPresenter';
import { forgetMenus, menusOnScreen } from '../../../src/interaction/menu/MenusOnScreen';

/**
 * The one owner of the plugin's menus: at most one open at a time, the one
 * open read as `currentMenu` (the E2E tests read it too), let go of once the
 * menu has closed. The menus are the mock's, which closes in Obsidian's
 * order (`hide()`, then the `onHide` callback, at once or after a closing).
 */

type Built = Menu & { shownAt: unknown };

const current = (presenter: MenuPresenter): Menu | null =>
    (presenter as unknown as { currentMenu: Menu | null }).currentMenu;

/** Present a menu, and the menu it showed, read as the one open. */
const shown = (presenter: MenuPresenter, build: unknown, anchor: MenuAnchor): Built | null => {
    presenter.present(build as never, anchor);
    return current(presenter) as Built | null;
};

/** A build that adds one item. */
const oneItem = (menu: { addItem(cb: unknown): unknown }) => { menu.addItem(() => { }); };

const AT = { kind: 'position', x: 3, y: 4 } as const;

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Menu.closingMs = null;
    forgetMenus();
});

describe('MenuPresenter.present', () => {
    it('shows the menu built and holds it as the one open', () => {
        const presenter = new MenuPresenter();
        const menu = shown(presenter, oneItem, AT)!;
        expect(menu).toBeInstanceOf(Menu);
        expect(menu.shownAt).toEqual({ x: 3, y: 4 });
        expect(current(presenter)).toBe(menu);
    });

    it('closes the menu open before it shows the next', () => {
        const presenter = new MenuPresenter();
        const steps: string[] = [];
        const names = new Map<Menu, string>();
        vi.spyOn(Menu.prototype, 'hide').mockImplementation(function (this: Menu) {
            steps.push('hide ' + names.get(this));
            return this;
        });
        vi.spyOn(Menu.prototype, 'showAtPosition').mockImplementation(function (this: Menu) {
            steps.push('show ' + (names.get(this) ?? 'next'));
        });
        const first = shown(presenter, oneItem, AT)!;
        names.set(first, 'first');
        steps.length = 0;
        presenter.present(oneItem as never, AT);
        expect(steps).toEqual(['hide first', 'show next']);
    });

    it('shows no menu when the build added no item', () => {
        const presenter = new MenuPresenter();
        const show = vi.spyOn(Menu.prototype, 'showAtPosition');
        presenter.present(() => { }, AT);
        expect(show).not.toHaveBeenCalled();
        expect(current(presenter)).toBeNull();
    });

    it('closes the menu open even when the next has no item', () => {
        const presenter = new MenuPresenter();
        const first = shown(presenter, oneItem, AT)!;
        const hide = vi.spyOn(first, 'hide');
        presenter.present(() => { }, AT);
        expect(hide).toHaveBeenCalledTimes(1);
        expect(current(presenter)).toBeNull();
    });

    it('lets go of the menu once it has closed', () => {
        const presenter = new MenuPresenter();
        const menu = shown(presenter, oneItem, AT)!;
        menu.close();
        expect(current(presenter)).toBeNull();
    });

    it('holds a menu still closing until its closing has run', () => {
        vi.useFakeTimers();
        Menu.closingMs = 250;
        const presenter = new MenuPresenter();
        const menu = shown(presenter, oneItem, AT)!;
        menu.hide();
        vi.advanceTimersByTime(249);
        expect(current(presenter)).toBe(menu);
        vi.advanceTimersByTime(1);
        expect(current(presenter)).toBeNull();
    });

    it('keeps the next menu when the one before it ends its closing after the next is shown', () => {
        vi.useFakeTimers();
        Menu.closingMs = 250;
        const presenter = new MenuPresenter();
        const first = shown(presenter, oneItem, AT)!;
        const next = shown(presenter, oneItem, AT)!;
        expect(first.hiding).toBe(true);
        vi.advanceTimersByTime(250);
        expect(first.hiding).toBe(false);
        expect(current(presenter)).toBe(next);
    });
});

describe('MenuPresenter and the menus on the screen', () => {
    it('tells the menu shown, and gone once its closing has run', () => {
        vi.useFakeTimers();
        Menu.closingMs = 250;
        const presenter = new MenuPresenter();
        const menu = shown(presenter, oneItem, AT)!;
        expect(menusOnScreen()).toBe(1);
        menu.close();
        vi.advanceTimersByTime(249);
        expect(menusOnScreen()).toBe(1);
        vi.advanceTimersByTime(1);
        expect(menusOnScreen()).toBe(0);
    });

    it('tells the menu before gone as the next is shown, at once where it goes at once', () => {
        const presenter = new MenuPresenter();
        shown(presenter, oneItem, AT);
        shown(presenter, oneItem, AT);
        expect(menusOnScreen()).toBe(1);
    });

    it('tells no menu when the build added no item', () => {
        const presenter = new MenuPresenter();
        presenter.present(() => { }, AT);
        expect(menusOnScreen()).toBe(0);
    });
});

describe('MenuPresenter\'s anchors', () => {
    it('shows at the position given', () => {
        const presenter = new MenuPresenter();
        const menu = shown(presenter, oneItem, { kind: 'position', x: 10, y: 20 })!;
        expect(menu.shownAt).toEqual({ x: 10, y: 20 });
    });

    it('shows at the mouse event given', () => {
        const presenter = new MenuPresenter();
        const event = { clientX: 5, clientY: 6 } as MouseEvent;
        const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent');
        presenter.present(oneItem as never, { kind: 'mouseEvent', event });
        expect(show).toHaveBeenCalledWith(event);
    });

    it('shows below the rect given, at its left', () => {
        const presenter = new MenuPresenter();
        const rect = { left: 7, right: 70, top: 8, bottom: 30 } as DOMRect;
        const menu = shown(presenter, oneItem, { kind: 'belowRect', rect })!;
        expect(menu.shownAt).toEqual({ x: 7, y: 30 });
    });
});

describe('MenuPresenter.dismiss', () => {
    it('closes the menu open', () => {
        const presenter = new MenuPresenter();
        const menu = shown(presenter, oneItem, AT)!;
        const hide = vi.spyOn(menu, 'hide');
        presenter.dismiss();
        expect(hide).toHaveBeenCalledTimes(1);
        expect(current(presenter)).toBeNull();
    });

    it('does nothing with no menu open', () => {
        const presenter = new MenuPresenter();
        const hide = vi.spyOn(Menu.prototype, 'hide');
        presenter.dismiss();
        expect(hide).not.toHaveBeenCalled();
    });
});

describe('the mock\'s Menu', () => {
    it('calls the callback onHide gave last, once, and none on a hide under way', () => {
        vi.useFakeTimers();
        const menu = new Menu();
        menu.closingMs = 100;
        const calls: string[] = [];
        menu.onHide(() => calls.push('first'));
        menu.onHide(() => calls.push('last'));
        menu.close();
        menu.hide();
        expect(calls).toEqual([]);
        vi.advanceTimersByTime(100);
        expect(calls).toEqual(['last']);
        menu.hide();
        vi.advanceTimersByTime(100);
        expect(calls).toEqual(['last']);
    });
});
