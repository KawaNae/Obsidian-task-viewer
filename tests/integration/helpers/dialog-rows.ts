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
 * Each takes the panel (`.tv-overlay__panel`, the hub's `.task-hub`);
 * `formRow` answers null when there is none.
 */
export const DIALOG_ROWS = `
const formRow = panel => panel?.querySelector(':scope > .tv-overlay__foot > .tv-form__buttons') ?? null;
const footShows = panel => [...(panel?.querySelector(':scope > .tv-overlay__foot')?.children ?? [])]
    .filter(el => !el.hidden && getComputedStyle(el).display !== 'none').map(el => el.className);
`;
