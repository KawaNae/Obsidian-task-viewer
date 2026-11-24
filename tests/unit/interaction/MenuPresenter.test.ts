import { describe, it, expect, vi, afterEach } from 'vitest';
import { Menu } from '../mocks/obsidian';
import { MenuPresenter } from '../../../src/interaction/menu/MenuPresenter';

/**
 * The one owner of the plugin's menus: at most one open at a time, the one
 * open read as `currentMenu` (the E2E tests read it too), let go of once the
 * menu has closed. The menus are the mock's, which closes in Obsidian's
 * order (`hide()`, then the `onHide` callback, at once or after a closing).
 */

type Built = Menu & { shownAt: unknown };

const current = (presenter: MenuPresenter): Menu | null =>
    (presenter as unknown as { currentMenu: Menu | null }).currentMenu;

/** A build that adds one item. */
const oneItem = (menu: { addItem(cb: unknown): unknown }) => { menu.addItem(() => { }); };

const AT = { kind: 'position', x: 3, y: 4 } as const;

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Menu.closingMs = null;
});

describe('MenuPresenter.present', () => {
    it('shows the menu built and holds it as the one open', () => {
        const presenter = new MenuPresenter();
        const menu = presenter.present(oneItem as never, AT) as unknown as Built;
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
        const first = presenter.present(oneItem as never, AT) as unknown as Menu;
        names.set(first, 'first');
        steps.length = 0;
        presenter.present(oneItem as never, AT);
        expect(steps).toEqual(['hide first', 'show next']);
    });

    it('shows no menu when the build added no item, and answers null', () => {
        const presenter = new MenuPresenter();
        const show = vi.spyOn(Menu.prototype, 'showAtPosition');
        expect(presenter.present(() => { }, AT)).toBeNull();
        expect(show).not.toHaveBeenCalled();
        expect(current(presenter)).toBeNull();
    });

    it('closes the menu open even when the next has no item', () => {
        const presenter = new MenuPresenter();
        const first = presenter.present(oneItem as never, AT) as unknown as Menu;
        const hide = vi.spyOn(first, 'hide');
        expect(presenter.present(() => { }, AT)).toBeNull();
        expect(hide).toHaveBeenCalledTimes(1);
        expect(current(presenter)).toBeNull();
    });

    it('lets go of the menu once it has closed', () => {
        const presenter = new MenuPresenter();
        const menu = presenter.present(oneItem as never, AT) as unknown as Menu;
        menu.close();
        expect(current(presenter)).toBeNull();
    });

    it('holds a menu still closing until its closing has run', () => {
        vi.useFakeTimers();
        Menu.closingMs = 250;
        const presenter = new MenuPresenter();
        const menu = presenter.present(oneItem as never, AT) as unknown as Menu;
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
        const first = presenter.present(oneItem as never, AT) as unknown as Menu;
        const next = presenter.present(oneItem as never, AT) as unknown as Menu;
        expect(first.hiding).toBe(true);
        vi.advanceTimersByTime(250);
        expect(first.hiding).toBe(false);
        expect(current(presenter)).toBe(next);
    });
});

describe('MenuPresenter\'s anchors', () => {
    it('shows at the position given', () => {
        const presenter = new MenuPresenter();
        const menu = presenter.present(oneItem as never, { kind: 'position', x: 10, y: 20 }) as unknown as Built;
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
        const menu = presenter.present(oneItem as never, { kind: 'belowRect', rect }) as unknown as Built;
        expect(menu.shownAt).toEqual({ x: 7, y: 30 });
    });
});

describe('MenuPresenter.dismiss', () => {
    it('closes the menu open', () => {
        const presenter = new MenuPresenter();
        const menu = presenter.present(oneItem as never, AT) as unknown as Menu;
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
