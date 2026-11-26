import { obsidianEval } from './cli-helper';
import { tr } from './view-helper';
import { UNTIL } from './waits';
import { MENUS } from './menus';
import { DIALOG_ROWS } from './dialog-rows';

/**
 * A row moved from its hub in the running E2E vault, as a person moves it:
 * the hub opened in the move from a card's menu ("Change Task Location"),
 * the destination's fields in the place of where the row stands, typed in,
 * items of their lists pressed with the pointer, and [Move] pressed.
 * `send.test.ts` and `note-candidates.test.ts` share it.
 *
 * What every snippet on the move starts with: the plugin, the hub as it is
 * drawn, and a press of the pointer as a mouse makes one.
 */
export const DIALOG = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
${UNTIL}
${MENUS}
${DIALOG_ROWS}
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const panel = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
/** The destination's fields, the note's and the heading's. */
const inputs = () => [...(panel()?.querySelectorAll('.task-hub__place input') ?? [])];
/** [Move]. */
const act = () => formRow(panel())?.querySelector('.mod-cta') ?? null;
const nameInput = () => panel()?.querySelector('.tv-form__name-section input') ?? null;
const shown = el => !!el && getComputedStyle(el).display !== 'none';
/** What is said under the row of \`input\`: its errors, or what is not an error. */
const saidUnder = (input, errors) => {
    const el = input?.closest('.tv-form__row')?.nextElementSibling;
    return el ? [...el.children].filter(c => c.classList.contains('tv-form__error') === errors).map(c => c.textContent) : [];
};
const state = () => ({
    open: !!panel(),
    closing: !!document.querySelector('.tv-overlay.is-closing'),
    note: inputs()[0]?.value ?? null,
    heading: inputs()[1]?.value ?? null,
    noteSays: saidUnder(inputs()[0], false).join(' ') || null,
    noteErrors: saidUnder(inputs()[0], true).join(' ') || null,
    says: saidUnder(inputs()[1], false).join(' ') || null,
    asking: shown(formRow(panel())?.querySelector('.tv-form__ask')),
    canSend: act() ? !act().disabled : false,
    tab: hubTabOn(panel()),
    focusOnNote: !!inputs()[0] && document.activeElement === inputs()[0],
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
    await until(() => item(), 3000, 'no ' + pick + ' in the list of ' + text);
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
    /** The note field, the heading field, and what is said under each. */
    note: string | null;
    heading: string | null;
    noteSays: string | null;
    noteErrors: string | null;
    says: string | null;
    asking: boolean;
    canSend: boolean;
    /** The hub's tab chosen. */
    tab: string | null;
    focusOnNote: boolean;
}

/**
 * Open the hub in a move of the row of the note `file` whose text is `name`,
 * from its card's menu (a card of a view's, outside the hub), once the
 * destination is answered.
 */
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
        menuItem(one => one.titleEl?.textContent === ${JSON.stringify(tr('menu.sendToNote'))});
        await until(() => panel() && inputs().length === 2 && act() && (state().canSend || state().noteErrors));
        await until(() => state().focusOnNote, 3000, 'the note field is not focused');
        return JSON.stringify(state());
    `);
}

/**
 * Close the hub if it is open, throwing the move away if it asks, and wait
 * until it has left the DOM: a list open on one of its fields closes as its
 * field is taken away, at the end of the overlay's closing.
 */
export function closeDialog(): void {
    onDialog(`
        panel()?.querySelector('.tv-overlay__close')?.click();
        await sleep(100);
        panel()?.querySelector('.tv-form__discard')?.click();
        await until(() => !document.querySelector('.tv-overlay .task-hub') && !document.querySelector('.suggestion-container'));
        return 'ok';
    `);
}
