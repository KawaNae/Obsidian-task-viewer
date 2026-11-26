import type { Menu } from 'obsidian';

/** An item a menu was given: what it shows, and what a press on it does. */
export interface MenuItemSpy {
    title: string;
    icon: string;
    disabled: boolean;
    click: (() => void) | null;
}

/** A menu shown: its items, in order, and where it was put. */
export interface MenuShown {
    items: MenuItemSpy[];
    anchor: unknown;
}

/**
 * A stand-in for the plugin's `menuPresenter`: each menu presented is built
 * on a menu that keeps its items, and kept as shown, as the presenter shows
 * a menu with an item at least.
 */
export function menuSpy() {
    const shown: MenuShown[] = [];
    const present = (build: (menu: Menu) => void, anchor: unknown) => {
        const items: MenuItemSpy[] = [];
        const menu = {
            addItem(cb: (item: unknown) => void) {
                const spy: MenuItemSpy = { title: '', icon: '', disabled: false, click: null };
                const item = {
                    setTitle(title: string) { spy.title = title; return item; },
                    setIcon(icon: string) { spy.icon = icon; return item; },
                    setDisabled(disabled: boolean) { spy.disabled = disabled; return item; },
                    onClick(click: () => void) { spy.click = click; return item; },
                };
                cb(item);
                items.push(spy);
                return menu;
            },
            addSeparator() { return menu; },
        };
        build(menu as unknown as Menu);
        if (items.length > 0) shown.push({ items, anchor });
    };
    return {
        presenter: { present },
        shown,
        /** The menu shown last; undefined before any. */
        last: (): MenuShown | undefined => shown[shown.length - 1],
    };
}
