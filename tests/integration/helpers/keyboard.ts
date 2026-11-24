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
 * - `showKeyboardAsIPad(height)`: the keyboard rising as iPad tells it, the
 *   did show 440ms after the will show (the overlap's transition, 250ms, has
 *   ended long before). Resolves once the did show has been sent
 * - `hideKeyboard()`: the keyboard going (the will hide, then the did hide)
 * - `overlapSettled(root, px)`: wait until the overlap the overlay's root
 *   is laid out by (`--tv-keyboard-overlap`) has come to `px` and no
 *   transition of it runs. The root moves the overlap over a transition, so
 *   what the overlap lays out is read at its end, not after a set time
 * - `recordFrames(root, body, field, px, { after, each, ms })`: what is seen
 *   at each animation frame, from the next one on, while the body moves
 *   with the keyboard: the overlap shown (`--tv-keyboard-overlap` as the
 *   root's computed style has it at that frame), the body's `scrollTop`, the
 *   field's bottom (`field`, an element or a function giving one, or null),
 *   the keyboard's top as the overlap lays it out (`innerHeight - overlap`)
 *   and the body's bottom. Resolves to the frames once the overlap has come
 *   to `px` and no transition of it runs (as `overlapSettled` waits), the
 *   `scrollTop` has stayed the same over the last 3 frames, and, given a
 *   promise `after` (`showKeyboardAsIPad`'s), a frame has been seen after it
 *   settled. `each(i, frames)` is called at each frame once it is recorded,
 *   to act on the body on the way. Throws after `ms` (3000). Called right
 *   after the keyboard is told, so the plugin's own frame for the body runs
 *   before each recorded: each frame is seen as the plugin left it
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
const showKeyboardAsIPad = height => {
    tellKeyboard('keyboardWillShow', height);
    return new Promise(resolve => setTimeout(() => {
        tellKeyboard('keyboardDidShow', height);
        resolve();
    }, 440));
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
const recordFrames = (root, body, field, px, { after = null, each = null, ms = 3000 } = {}) => new Promise((resolve, reject) => {
    const frames = [];
    // The index of the first frame seen once \`after\` settled.
    let afterFrom = after ? null : 0;
    after?.then(() => { afterFrom = frames.length; });
    const t0 = performance.now();
    const step = () => {
        const overlap = parseFloat(overlapOf(root)) || 0;
        const el = typeof field === 'function' ? field() : field;
        frames.push({
            t: performance.now() - t0,
            overlap,
            scrollTop: body.scrollTop,
            field: el ? el.getBoundingClientRect().bottom : null,
            keyboardTop: innerHeight - overlap,
            bodyBottom: body.getBoundingClientRect().bottom,
        });
        try {
            each?.(frames.length - 1, frames);
        } catch (e) {
            reject(e);
            return;
        }
        const last = frames.slice(-3);
        const still = last.length === 3 && last.every(f => f.scrollTop === last[2].scrollTop);
        if (afterFrom !== null && frames.length > afterFrom && still
            && !overlapMoving(root) && overlapOf(root) === px + 'px') {
            resolve(frames);
        } else if (performance.now() - t0 > ms) {
            reject(new Error('timed out after ' + ms + ' ms recording frames: the overlap is ' + overlapOf(root)
                + (overlapMoving(root) ? ', moving' : '') + ', the scrollTops last ' + last.map(f => f.scrollTop).join(',')
                + (afterFrom === null ? ', waiting for what came after' : '')));
        } else {
            requestAnimationFrame(step);
        }
    };
    requestAnimationFrame(step);
});
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
