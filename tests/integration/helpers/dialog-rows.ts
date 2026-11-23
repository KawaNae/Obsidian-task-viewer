/**
 * JavaScript that defines, in a snippet `obsidian eval` runs, where a
 * dialog's row of buttons is looked for. The row stands in the foot of the
 * dialog's panel, below the body, which does not scroll with it
 * (`OverlayFrame`), and the tests look for it here alone.
 *
 * - `formRow(panel)`: the row of the dialog's form; in the hub, the form's
 *   (the create of a task not written yet, the question a close puts)
 *
 * It takes the panel (`.tv-overlay__panel`, the hub's `.task-hub`) and
 * answers null when there is none.
 */
export const DIALOG_ROWS = `
const formRow = panel => panel?.querySelector(':scope > .tv-overlay__foot > .tv-form__buttons') ?? null;
`;
