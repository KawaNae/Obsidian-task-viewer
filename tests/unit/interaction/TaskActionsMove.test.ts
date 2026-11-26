import { describe, it, expect, vi } from 'vitest';
import { TaskActionsMenuBuilder } from '../../../src/interaction/menu/builders/TaskActionsMenuBuilder';
import { t } from '../../../src/i18n';
import { makeTask } from '../helpers/makeTask';

/**
 * The card menu's destructive items (`addDestructiveActions`): Change Task
 * Location moves the row from its hub, as the caller says (`beginMove`), named
 * and placed as before, and asks no destructive follow-up of its own.
 */

/** A menu that keeps its items in order, each with its title, its icon and its click; a separator as `---`. */
function recordingMenu() {
    const items: { title: string; icon: string; click: (() => unknown) | null }[] = [];
    const close = vi.fn();
    const menu = {
        addItem(build: (item: unknown) => void) {
            const one = { title: '', icon: '', click: null as (() => unknown) | null };
            const item = {
                setTitle(value: string) { one.title = value; return item; },
                setIcon(value: string) { one.icon = value; return item; },
                setWarning() { return item; },
                onClick(fn: () => unknown) { one.click = fn; return item; },
            };
            build(item);
            items.push(one);
            return menu;
        },
        addSeparator() { items.push({ title: '---', icon: '', click: null }); return menu; },
        close,
    };
    return { menu, items, close };
}

describe('Change Task Location', () => {
    it('stands after Open in Editor and before the separator and Delete, with its name and icon', () => {
        const builder = new TaskActionsMenuBuilder({} as never, {} as never, {} as never);
        const { menu, items } = recordingMenu();
        builder.addDestructiveActions(menu as never, makeTask(), () => { });
        expect(items.map(item => [item.title, item.icon])).toEqual([
            [t('menu.openInEditor'), 'document'],
            [t('menu.sendToNote'), 'send'],
            ['---', ''],
            [t('menu.deleteTask'), 'trash'],
        ]);
    });

    it('closes the menu and begins the move as the caller says, with no destructive follow-up', () => {
        const builder = new TaskActionsMenuBuilder({} as never, {} as never, {} as never);
        const { menu, items, close } = recordingMenu();
        const beginMove = vi.fn();
        const onDestructive = vi.fn();
        builder.addDestructiveActions(menu as never, makeTask(), beginMove, onDestructive);
        void items.find(item => item.title === t('menu.sendToNote'))!.click!();
        expect(close).toHaveBeenCalled();
        expect(beginMove).toHaveBeenCalledTimes(1);
        expect(onDestructive).not.toHaveBeenCalled();
    });
});
