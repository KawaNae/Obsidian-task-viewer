/**
 * JavaScript that defines, in a snippet `obsidian eval` runs, how the tests
 * find and drive the hub on a task not written yet: its card, its fields,
 * its tabs ("General" and "Details"), the fields of its place, and the line
 * above its create. It needs `UNTIL`, `DIALOG_ROWS` and `MENUS` before it.
 *
 * - `draft()`: the hub on a task not written yet (the hub that offers a
 *   create); null when none is open
 * - `tab(id)`, `tabOn()`, `paneOf(id)`: a tab's button by its id (`basic`,
 *   `detail`), the id of the tab chosen, and the pane a tab chooses
 *   (`hubTab`, `hubTabOn`, `hubPane` on this hub)
 * - `placeInputs()`, `noteInput()`, `headingInput()`: the text fields of the
 *   place, under the dates in the basic tab, the note's first
 * - `lineSays()`: what the line above the create says, each as
 *   `class: text`; `says(input)`: what is said under a field's row, the same
 * - `typeIn(input, text)`: typed as a person types, the text and then its
 *   input event, not left; `type`: typed and left, so the field commits
 * - `retyped(input, text)`: typed in a place field, and waited for the line
 *   above the create to say what it says of the place it now names
 * - `holdReads()`: the vault's reads held until `R.releaseReads()`, put back
 *   by `R.unhold()` (the clean-up's too)
 */
export const DRAFT_HUB = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const R = (window.__tvDraftHubE2E ??= { leaves: {} });
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const overlays = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing)')];
const draft = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub')]
    .find(p => formRow(p)?.querySelector(':scope > .mod-cta')) ?? null;
const nameInput = () => draft()?.querySelector('.tv-form__name-section input') ?? null;
const rowOf = label => [...draft().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const dateInput = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input');
const tab = id => hubTab(draft(), id);
const tabOn = () => hubTabOn(draft());
const paneOf = id => hubPane(draft(), id);
const placeInputs = () => [...(draft()?.querySelectorAll('.task-hub__place input.tv-ctrl__text-input') ?? [])];
const noteInput = () => placeInputs()[0] ?? null;
const headingInput = () => placeInputs()[1] ?? null;
const says = input => [...input.closest('.tv-form__row').nextElementSibling.children].map(c => c.className + ': ' + c.textContent);
const lineSays = () => [...(draft()?.querySelector(':scope > .tv-overlay__foot > .task-hub__create-line .task-hub__create-says')?.children ?? [])].map(c => c.className + ': ' + c.textContent);
const createButton = () => formRow(draft()).querySelector(':scope > .mod-cta');
const create = () => createButton().click();
const card = () => draft()?.querySelector('.task-hub__preview .task-card') ?? null;
const disk = path => app.vault.adapter.read(path);
const typeIn = (input, text) => { input.focus(); input.value = text; input.setSelectionRange(text.length, text.length); input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const type = (input, text) => { typeIn(input, text); input.dispatchEvent(new FocusEvent('blur')); };
const retyped = async (input, text) => {
    const before = JSON.stringify(lineSays());
    typeIn(input, text);
    await until(() => JSON.stringify(lineSays()) !== before, 3000, () => 'still ' + before);
    return lineSays();
};
const holdReads = () => {
    const real = app.vault.read;
    let open;
    const gate = new Promise(r => { open = r; });
    R.held = 0;
    app.vault.read = function (...args) { R.held++; return gate.then(() => real.apply(this, args)); };
    R.releaseReads = () => open();
    R.unhold = () => { app.vault.read = real; open(); delete R.unhold; delete R.releaseReads; };
};
/** Pick the item titled so in the menu open now (on macOS the menu may be the native one, outside the DOM). */
const pick = async title => {
    await until(() => menuTitles().includes(title), 3000, () => menuTitles().join('|'));
    menuItem(i => i.titleEl?.textContent === title);
};
/** A Timeline on \`day\`, its leaf kept to be closed after. */
const timeline = async day => {
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'timeline-view', state: { date: day }, active: true });
    R.leaves.tl = leaf;
    return leaf;
};
/** The menu of the all-day lane's empty space on \`day\`, and its item titled so picked. */
const fromAllDay = async (day, title) => {
    const leaf = await timeline(day);
    let cell = null;
    await until(() => (cell = leaf.view.contentEl.querySelector('.allday-section__cell[data-date="' + day + '"]')));
    const r = cell.getBoundingClientRect();
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
    await pick(title);
};
/** Close every overlay, throwing away what a hub asks about, then the menu, the leaves opened and the reads held. */
const cleanUpHubs = async () => {
    R.unhold?.();
    for (let i = 0; i < 6 && overlays().length > 0; i++) {
        const top = overlays().pop();
        const discard = () => [...top.querySelectorAll('.tv-form__discard')].find(shown);
        if (discard()) discard().click();
        else top.querySelector('.tv-overlay__close').click();
        await until(() => !overlays().includes(top) || discard());
    }
    plugin.menuPresenter.dismiss();
    for (const name of Object.keys(R.leaves)) { R.leaves[name]?.detach(); delete R.leaves[name]; }
};
`;
