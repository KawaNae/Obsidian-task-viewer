/**
 * Putting the focus on a field once nothing moves around it: the plugin's
 * menus gone from the screen, and its overlays opened.
 *
 * A field focused raises the on-screen keyboard, and what still moves then
 * moves with it: a menu shown as a sheet on a phone's layout, sliding away
 * once an item is chosen, rises with the keyboard; an overlay's panel still
 * sliding or popping in has the field focused where it stands midway, and
 * WebKit scrolls the body by that place. So a focus asked for while a menu
 * is on the screen (`MenusOnScreen`, for `MENU_GONE_BOUND_MS` at most) or an
 * overlay is opening (`OverlayRegistry.whenOverlaysOpened`) is put once they
 * are done; with neither, it is put at once, in the caller's own task.
 *
 * - The last ask in a document wins: an earlier one still waiting is dropped.
 * - When the wait ends, the focus is not put on a field gone from the
 *   document, nor once the user has moved the focus elsewhere since the ask
 *   (`stillWanted` says what counts as wanted instead, where given).
 * - While it waits, what the caller names (`hold`, an overlay's panel)
 *   holds the focus, which raises no keyboard.
 *
 * What only keeps a focus where it is (a part drawn again, an editor's own
 * keys) or answers a press on a button does not come here: nothing moves
 * there, and a keyboard closed for a moment would drop what is being typed.
 */

import { focusField, type FieldFocus, type Focusable } from '../../utils/FieldFocus';
import { whenMenusGone, type MenusGone } from '../../interaction/menu/MenusOnScreen';
import { whenOverlaysOpened } from './OverlayRegistry';
import { logDebug } from '../../log/log';

export interface PlaceFocusOptions {
    /** What holds the focus while the ask waits: an overlay's panel, which raises no keyboard. */
    hold?: Focusable;
    /**
     * Whether the focus is still wanted where asked, once the wait has
     * ended. Not given: unless the focus has moved since the ask to
     * anything but `hold` or the document's body.
     */
    stillWanted?: () => boolean;
    /** Given to the field's `focus` as they are (`preventScroll`). */
    focusOptions?: FocusOptions;
}

/** What an ask waits for, and how it is timed and told. */
export interface FocusWaits {
    /** The plugin's menus on the screen going, or null for none. */
    menus(): Promise<MenusGone> | null;
    /** The plugin's overlays opening having opened, or null for none. */
    overlays(): Promise<void> | null;
    now(): number;
    log(message: string): void;
}

const LIVE: FocusWaits = {
    menus: whenMenusGone,
    overlays: whenOverlaysOpened,
    now: () => performance.now(),
    log: logDebug,
};

/** The last ask, by the document it is in. */
const lastAsk = new WeakMap<object, object>();
/** The key of the asks whose document is not known. */
const NO_DOCUMENT = {};

/**
 * Put the focus on `focus`'s field, its text met as it says, once the
 * plugin's menus have gone and its overlays have opened: at once when
 * nothing is to wait for.
 * @returns whether the focus was put at once.
 */
export function placeFocus(focus: FieldFocus, opts: PlaceFocusOptions = {}): boolean {
    return placeFocusWith(LIVE, focus, opts);
}

/** {@link placeFocus}, waiting for what `waits` says. */
export function placeFocusWith(waits: FocusWaits, focus: FieldFocus, opts: PlaceFocusOptions = {}): boolean {
    const doc = documentOf(focus.to) ?? documentOf(opts.hold) ?? activeDocument();
    const key = doc ?? NO_DOCUMENT;
    const ask = {};
    lastAsk.set(key, ask);

    const menus = waits.menus();
    const overlays = waits.overlays();
    if (!menus && !overlays) {
        focusField(focus, opts.focusOptions);
        return true;
    }

    opts.hold?.focus({ preventScroll: true });
    const asked = doc?.activeElement ?? null;
    const start = waits.now();
    let menusMs: number | null = null;
    let openingMs: number | null = null;
    let bound = false;
    const timed = Promise.all([
        menus?.then((how) => { menusMs = waits.now() - start; bound = how === 'bound'; }),
        overlays?.then(() => { openingMs = waits.now() - start; }),
    ]);

    void timed.then(() => {
        const how = lastAsk.get(key) !== ask ? 'superseded'
            : !attached(focus.to) ? 'field gone'
            : !(opts.stillWanted ?? (() => stayed(doc, asked, opts.hold)))() ? 'not wanted'
            : 'placed';
        waits.log(
            `[kb] focus ${how} after=${ms(waits.now() - start)}` +
            ` menus=${ms(menusMs)}${bound ? ' (bound)' : ''} opening=${ms(openingMs)}`);
        if (how !== 'placed') return;
        lastAsk.delete(key);
        focusField(focus, opts.focusOptions);
    });
    return false;
}

/** Whether the focus is where it was at the ask, or on `hold`, or on nothing (the body). */
function stayed(doc: Document | null, asked: Element | null, hold: Focusable | undefined): boolean {
    if (!doc) return true;
    const active = doc.activeElement;
    return active === asked || active === null || active === doc.body || active === (hold as unknown);
}

/** Whether `to` is in its document; what is no node (an editor that focuses itself) is taken as in. */
function attached(to: Focusable): boolean {
    return (to as Partial<Node>).isConnected !== false;
}

function documentOf(to: Focusable | undefined): Document | null {
    return (to as Partial<Node> | undefined)?.ownerDocument ?? null;
}

function activeDocument(): Document | null {
    return (globalThis as { activeDocument?: Document }).activeDocument ?? null;
}

function ms(value: number | null): string {
    return value === null ? '-' : `${Math.round(value)}ms`;
}
