import { obsidianEval } from './cli-helper';

/**
 * The send dialog driven in the running Dev vault, as a person drives it:
 * opened from a card's menu, fields typed in, items of their lists pressed
 * with the pointer. `send.test.ts` and `note-candidates.test.ts` share it.
 *
 * What every snippet on the dialog starts with: the plugin, the dialog as it
 * is drawn, and a press of the pointer as a mouse makes one.
 */
export const DIALOG = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const panel = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-send');
const inputs = () => [...(panel()?.querySelectorAll('.tv-send__destination input') ?? [])];
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const viewOf = which => {
    const el = panel()?.querySelector('.tv-source-editor__' + which + ' .cm-content');
    return el ? (el.cmTile?.view ?? el.cmView?.rootView?.view ?? null) : null;
};
/** What is said under the row of \`input\`: its errors, or what is not an error. */
const saidUnder = (input, errors) => {
    const el = input?.closest('.tv-form__row')?.nextElementSibling;
    return el ? [...el.children].filter(c => c.classList.contains('tv-form__error') === errors).map(c => c.textContent) : [];
};
const state = () => ({
    open: !!panel(),
    closing: !!document.querySelector('.tv-overlay.is-closing'),
    folder: inputs()[0]?.value ?? null,
    name: inputs()[1]?.value ?? null,
    heading: inputs()[2]?.value ?? null,
    says: saidUnder(inputs()[2], false).join(' ') || null,
    asking: shown(panel()?.querySelector('.tv-form__ask')),
    canSend: panel() ? !panel().querySelector('.tv-form__buttons .mod-cta').disabled : false,
    editors: panel()?.querySelectorAll('.tv-send__rows .cm-content').length ?? 0,
    fixed: panel()?.querySelector('.tv-send__fixed pre')?.textContent ?? null,
    why: panel()?.querySelector('.tv-send__fixed .tv-form__info')?.textContent ?? null,
});
const press = el => {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + 4, clientY: r.top + 4, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new MouseEvent('mousedown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
    el.dispatchEvent(new MouseEvent('mouseup', at));
    el.dispatchEvent(new MouseEvent('click', at));
};
/** The items of the list open now. */
const items = () => [...document.querySelectorAll('.suggestion-container .suggestion-item')];
/** An item as it reads: its title and the line under it (a note's folder), or its text when it has no title. */
const itemOf = el => {
    const title = el.querySelector('.suggestion-title');
    return title ? { title: title.textContent, note: el.querySelector('.suggestion-note')?.textContent ?? null } : { title: el.textContent, note: null };
};
/** Type \`text\` into the input \`input\` as a person does: the text, then its input event. */
const typeIn = (input, text) => {
    input.focus();
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};
/**
 * Type \`text\` into the field \`i\` of the destination, and press the item of
 * its list whose title is \`pick\` (and whose note is \`note\`, when given).
 */
const pickFrom = async (i, text, pick, note) => {
    typeIn(inputs()[i], text);
    const item = () => items().find(el => itemOf(el).title === pick && (note === undefined || itemOf(el).note === note));
    if (!(await until(() => item()))) throw new Error('no ' + pick + ' in the list of ' + text);
    press(item());
    await sleep(100);
};
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the dialog's prelude. */
export function onDialog<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${DIALOG}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

export interface DialogState {
    open: boolean;
    closing: boolean;
    name: string | null;
    folder: string | null;
    heading: string | null;
    says: string | null;
    asking: boolean;
    canSend: boolean;
    editors: number;
    fixed: string | null;
    why: string | null;
}

/** Open the dialog on the row of the note `file` whose text is `name`, from its card's menu (a card of the hub's). */
export function openDialog(file: string, name: string): DialogState {
    return onDialog<DialogState>(`
        const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(file)} && t.content === ${JSON.stringify(name)});
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        // The card menu the hub's cards open, made as a hub first opens.
        if (!plugin.taskHub.cards) {
            plugin.openTaskHub(task.id);
            await until(() => document.querySelector('.task-hub'));
            document.querySelector('.task-hub')?.closest('.tv-overlay__panel')?.querySelector('.tv-overlay__close')?.click();
            await until(() => !document.querySelector('.task-hub'));
        }
        await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
        const menu = plugin.menuPresenter.currentMenu;
        const item = menu?.items.find(one => one.titleEl?.textContent === 'ノートへ送る');
        if (!item) throw new Error('no send in the menu');
        menu.hide();
        item.callback(new MouseEvent('click'));
        await until(() => panel() && state().canSend);
        return JSON.stringify(state());
    `);
}

/**
 * Close the dialog if it is open, throwing its draft away if it asks, and
 * wait until it has left the DOM: a list open on one of its fields closes
 * as its field is taken away, at the end of the overlay's closing.
 */
export function closeDialog(): void {
    onDialog(`
        panel()?.querySelector('.tv-overlay__close')?.click();
        await sleep(100);
        panel()?.querySelector('.tv-form__discard')?.click();
        await until(() => !document.querySelector('.tv-overlay .tv-send') && !document.querySelector('.suggestion-container'));
        return 'ok';
    `);
}
