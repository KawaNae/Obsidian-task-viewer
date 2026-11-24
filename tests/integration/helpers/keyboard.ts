import { obsidianEval } from './cli-helper';
import { UNTIL } from './waits';

/**
 * The on-screen keyboard told to the running E2E vault, as Obsidian mobile
 * tells it: Capacitor's events on the window (`keyboardWillShow`,
 * `keyboardDidShow`, `keyboardWillHide`, `keyboardDidHide`), a show carrying
 * the keyboard's height in `keyboardHeight`. The desktop's visualViewport
 * never changes, so these events are all the plugin hears of it, as on a
 * device whose WebView is not resized.
 *
 * JavaScript put in a snippet `obsidian eval` runs, after `UNTIL`:
 * - `tellKeyboard(type, height)`: send one of the four events, with
 *   `height` as its `keyboardHeight` when given
 * - `showKeyboard(height)`: the keyboard rising, as a device tells it (the
 *   will show, then the did show, each with the height)
 * - `hideKeyboard()`: the keyboard going (the will hide, then the did hide)
 * - `overlapSettled(root, px)`: wait until the overlap the overlay's root
 *   is laid out by (`--tv-keyboard-overlap`) has come to `px` and no
 *   transition of it runs. The root moves the overlap over a transition, so
 *   what the overlap lays out is read at its end, not after a set time
 * - `phoneLayout()`: lay the overlays out as a phone's sheet (`.is-phone`
 *   on the body, as Obsidian puts it on a phone), marked so
 *   `resetKeyboard` takes it off again
 */
export const KEYBOARD = `
const tellKeyboard = (type, height) => {
    const e = new Event(type);
    if (height !== undefined) e.keyboardHeight = height;
    window.dispatchEvent(e);
};
const showKeyboard = height => {
    tellKeyboard('keyboardWillShow', height);
    tellKeyboard('keyboardDidShow', height);
};
const hideKeyboard = () => {
    tellKeyboard('keyboardWillHide');
    tellKeyboard('keyboardDidHide');
};
const overlapOf = root => getComputedStyle(root).getPropertyValue('--tv-keyboard-overlap').trim();
const overlapMoving = root => root.getAnimations().some(a => a.transitionProperty === '--tv-keyboard-overlap');
const overlapSettled = (root, px) => until(
    () => !overlapMoving(root) && overlapOf(root) === px + 'px',
    3000,
    () => 'the overlap is ' + overlapOf(root) + (overlapMoving(root) ? ', moving' : ''),
);
const phoneLayout = () => {
    if (document.body.classList.contains('is-phone')) return;
    document.body.classList.add('is-phone');
    window.__tvKeyboardPhone = true;
};
`;

/**
 * Put the window back as a test that told it a keyboard found it: the
 * keyboard gone (the height told last is the keyboard module's, kept by
 * window across the tests, and would lay out the next overlay opened over
 * a keyboard), and the phone's layout taken off where `phoneLayout` put it.
 */
export function resetKeyboard(): void {
    const result = obsidianEval(`(async () => {
        ${UNTIL}
        ${KEYBOARD}
        hideKeyboard();
        if (window.__tvKeyboardPhone) {
            document.body.classList.remove('is-phone');
            delete window.__tvKeyboardPhone;
        }
        return JSON.stringify(true);
    })()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
}
