import { setIcon } from 'obsidian';
import type { MenuPresenter } from '../../interaction/menu/MenuPresenter';
import { commitOf, menuOver, pressKey } from '../../views/sharedUI/PressCommit';

/** A line at the head of a field's menu: greyed, taking no press, saying what the value is. */
export interface FieldMenuHead {
    readonly title: string;
    readonly icon: string;
}

/** An item of a field's menu: greyed and taking no press when `run` is null. */
export interface FieldMenuItem {
    readonly title: string;
    readonly icon: string;
    readonly run: (() => void) | null;
    /**
     * Whether the item puts no value in the fields (it opens the line the
     * value is inherited from): a text typed in them and refused is left
     * as typed. Any other item puts its value in the text's stead.
     */
    readonly keepsTyped?: boolean;
}

/** A field's menu: its heads, a separator under them, then its items. A menu with no item draws no button. */
export interface FieldMenu {
    readonly heads: readonly FieldMenuHead[];
    readonly items: readonly FieldMenuItem[];
}

export interface FieldMenuButtonOptions {
    /** What the button is called (`aria-label`). */
    label: string;
    /** The button's key among the buttons of its surface (`pressKey`), where a commit can build it anew. */
    key: string;
    /** The fields whose value the menu's items put (`menuOver`): the field's input, both of the due's, a list's item and add fields. */
    fields: () => readonly HTMLElement[];
    /** The menu as the field is now: read as the button is drawn, synced and pressed. */
    menu: () => FieldMenu;
    presenter: MenuPresenter;
    /** Whether the field takes no edit now: the button takes no press. */
    disabled?: () => boolean;
    /** `inline`: the button stands in a row of chips, at its end, not over a field's end. */
    inline?: boolean;
    signal?: AbortSignal;
}

/**
 * The … at the end of a field, which opens the field's menu under it. It
 * stands over the field's end (`tv-form__has-menu`, `_form.css`), the
 * field's text keeping clear of it. It is out of the Tab order, and no key
 * opens it: the menu is one a press opens. A press on it takes no focus
 * from the field, and commits what is typed first, as the hub's buttons do
 * (`holdPresses`, keyed by `pressKey`): the menu is the field's as it is
 * then. A text in its fields that cannot be committed does not keep the
 * menu shut (`menuOver`): an item picked then throws the text away and
 * puts its own value in its stead. It is shown while the menu has an
 * item: the owner calls
 * {@link sync} once what the menu is read from has changed.
 */
export class FieldMenuButton {
    readonly button: HTMLButtonElement;

    constructor(box: HTMLElement, private readonly opts: FieldMenuButtonOptions) {
        if (!opts.inline) box.addClass('tv-form__has-menu');
        this.button = box.createEl('button', {
            cls: opts.inline ? 'tv-icon-btn tv-form__menu-button tv-form__menu-button--inline' : 'tv-icon-btn tv-form__menu-button',
            attr: { type: 'button', 'aria-label': opts.label },
        });
        this.button.tabIndex = -1;
        setIcon(this.button.createSpan(), 'more-horizontal');
        pressKey(this.button, opts.key);
        menuOver(this.button, opts.fields);
        this.button.addEventListener('click', () => {
            if (opts.disabled?.()) return;
            const { heads, items } = opts.menu();
            if (items.length === 0) return;
            opts.presenter.present((menu) => {
                for (const head of heads) menu.addItem(item => item.setTitle(head.title).setIcon(head.icon).setDisabled(true));
                if (heads.length > 0) menu.addSeparator();
                for (const entry of items) {
                    menu.addItem((item) => {
                        item.setTitle(entry.title).setIcon(entry.icon).setDisabled(entry.run === null);
                        const run = entry.run;
                        if (run) {
                            item.onClick(() => {
                                if (!entry.keepsTyped) for (const field of opts.fields()) commitOf(field)?.drop?.();
                                run();
                            });
                        }
                    });
                }
            }, { kind: 'belowRect', rect: this.button.getBoundingClientRect() });
        }, { signal: opts.signal });
        this.sync();
    }

    /** Shown while the menu has an item, and taking a press while the field takes edits. */
    sync(): void {
        this.button.style.display = this.opts.menu().items.length > 0 ? '' : 'none';
        this.button.disabled = this.opts.disabled?.() ?? false;
    }
}
