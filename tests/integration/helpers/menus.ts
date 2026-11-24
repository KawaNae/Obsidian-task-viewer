/**
 * JavaScript that defines, in a snippet `obsidian eval` runs, the menu the
 * plugin has open (`MenuPresenter.currentMenu`) and the choosing of its
 * items. On macOS the menu is the OS's native one, outside the DOM, so its
 * items are read from the Menu, and an item is chosen by running its
 * callback as a click on it would.
 *
 * - `menuItems()`: the items of the menu open, none when none is
 * - `menuTitles()`: their titles, separators left out
 * - `closeMenus()`: close the menu open
 * - `menuItem(pred, opts)`: choose the first item `pred(item, index)` takes,
 *   throwing with the titles there when none is. `opts.within` takes the
 *   item of the menu whose submenu the item is in.
 *
 * By default the menu is closed, then the item's callback run, so the menu
 * has gone, its `onHide` with it, by the time the callback acts.
 *
 * `opts.closingMs` makes the menu take that long to go once told to, as the
 * phone's sheet does with its closing: Obsidian calls the menu's `onHide`
 * once the sheet has slid away, and the menu is `currentMenu` until then.
 * The menu's `hide` waits that long before it runs, the first time it is
 * called (`close()` calls it too, and a callback that closes the menu
 * itself waits as well); then the callback is run and the menu told to
 * hide, in the order Obsidian's own click takes.
 */
export const MENUS = `
const tvMenus = () => app.plugins.plugins['obsidian-task-viewer'].menuPresenter;
const menuItems = () => tvMenus().currentMenu?.items ?? [];
const menuTitles = () => menuItems().map(i => i.titleEl?.textContent ?? '').filter(Boolean);
const closeMenus = () => tvMenus().dismiss();
const menuItem = (pred, opts = {}) => {
    const menu = tvMenus().currentMenu;
    const titlesOf = items => items.map(i => i.titleEl?.textContent ?? '---').join('|');
    let items = menu?.items ?? [];
    if (opts.within) {
        const parent = items.find(opts.within);
        if (!parent?.submenu) throw new Error('no such submenu among ' + titlesOf(items));
        items = parent.submenu.items;
    }
    const item = items.find(pred);
    if (!item) throw new Error('no such menu item among ' + titlesOf(items));
    if (opts.closingMs === undefined) {
        menu.hide();
        item.callback(new MouseEvent('click'));
        return;
    }
    const hide = menu.hide;
    let closing = null;
    menu.hide = () => {
        closing ??= setTimeout(() => { menu.hide = hide; hide.call(menu); }, opts.closingMs);
        return menu;
    };
    item.callback(new MouseEvent('click'));
    menu.hide();
};
`;
