/**
 * JavaScript that defines, in a snippet `obsidian eval` runs, where a
 * dialog's row of buttons is looked for. The row stands in the foot of the
 * dialog's panel, below the body, which does not scroll with it
 * (`OverlayFrame`), and the tests look for it here alone.
 *
 * - `formRow(panel)`: the row of the dialog's form; in the hub, the form's
 *   (the create of a task not written yet, the question a close puts)
 * - `footShows(panel)`: the classes of what the foot shows, in its order (on
 *   a task not written yet, the line above the create,
 *   `task-hub__create-line`; the hub's form's row, `tv-form__buttons`; its
 *   source mode's, `task-hub__source-actions`)
 *
 * The hub's form (on a task not written yet and on a row alike) holds its
 * fields in two tabs, `basic` (the name, the status, the dates, the place)
 * and `detail` (the tags, the style, the mask, the properties). A field of
 * the tab not chosen is `inert`: it takes no focus, so a test chooses its
 * tab before it puts the focus there.
 *
 * - `hubTab(panel, id)`: the button of the hub's tab `id`
 * - `hubTabOn(panel)`: the id of the hub's tab chosen
 * - `hubPane(panel, id)`: the pane the tab `id` chooses
 * - `chooseHubTab(panel, id)`: the tab `id` chosen by a click on its button,
 *   as a person chooses it; answers its pane
 * - `chooseTabOf(el)`: the tab whose pane holds `el` chosen by a click on
 *   its button when that pane is off, as a person taps the tab before the
 *   field; answers `el`
 *
 * Each takes the panel (`.tv-overlay__panel`, the hub's `.task-hub`);
 * `formRow` and `hubTab` answer null when there is none.
 */
export const DIALOG_ROWS = `
const formRow = panel => panel?.querySelector(':scope > .tv-overlay__foot > .tv-form__buttons') ?? null;
const footShows = panel => [...(panel?.querySelector(':scope > .tv-overlay__foot')?.children ?? [])]
    .filter(el => !el.hidden && getComputedStyle(el).display !== 'none').map(el => el.className);
const hubTab = (panel, id) => panel?.querySelector('.task-hub__form > .tv-tabs > button.tv-tabs__tab[data-tab="' + id + '"]') ?? null;
const hubTabOn = panel => panel?.querySelector('.task-hub__form > .tv-tabs > button.tv-tabs__tab[aria-selected="true"]')?.dataset.tab ?? null;
const hubPane = (panel, id) => panel.ownerDocument.getElementById(hubTab(panel, id).getAttribute('aria-controls'));
const chooseHubTab = (panel, id) => { hubTab(panel, id).click(); return hubPane(panel, id); };
const chooseTabOf = el => {
    const pane = el.closest('.tv-tabs__pane[role="tabpanel"]');
    if (pane?.hasAttribute('inert')) el.ownerDocument.querySelector('button.tv-tabs__tab[aria-controls="' + pane.id + '"]').click();
    return el;
};
`;
