/**
 * Whether a keydown is an Enter the form should act on (submit, commit), not
 * the Enter an IME uses to commit a conversion or pick a candidate.
 *
 * Browsers disagree on how that Enter arrives. Chromium sends it with
 * `isComposing` true; Safari ends the composition first and then sends it with
 * `isComposing` false and `keyCode` 229. A field that tracks composition
 * itself (`BracketPairingHandle.isComposing`) passes that as `composing`.
 */
export function isFormEnter(e: KeyboardEvent, composing = false): boolean {
    return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !composing;
}
