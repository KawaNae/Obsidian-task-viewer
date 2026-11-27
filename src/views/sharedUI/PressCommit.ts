/**
 * What a press on a button needs to know of the fields around it, kept by
 * the fields and the buttons themselves, so that one place of the surface
 * they stand in can commit what a field holds before the button acts.
 *
 * - A field that commits what is typed in it (a blur or the form's Enter)
 *   says how it commits ({@link ownCommit}): one table, by the field.
 * - A button that a commit can take out, as the part it stands in is built
 *   anew, has a key ({@link pressKey}): the button standing for the same
 *   thing once it is built anew has the same key. A part whose buttons
 *   move to other places as it is written (a list's items) says where each
 *   key goes ({@link carryPressKeys}).
 * - A button that belongs to one field (its ×) says so ({@link ownControl});
 *   a field's menu button says which fields its items put a value in
 *   ({@link menuOver});
 *   a button that changes only what is shown says so ({@link showsOnly});
 *   a button that saves or throws away what is typed on its own way (a
 *   close, a cancel, a move begun) says so too ({@link takesTyped}); a part
 *   whose presses are its own (a card drawn in the surface) says so
 *   ({@link leavePresses}).
 *
 * The surface that holds its presses ({@link holdPresses}) reads them all.
 */

/** How a field commits what is typed in it, as its blur and its Enter do. */
export interface FieldCommit {
    /** Whether the field holds something typed that it has not committed. */
    typed(): boolean;
    /**
     * Commit it as the field's Enter does. False when the field keeps it
     * as typed, refused at once (a text that does not read, a value the
     * form's rules refuse), said in the field's own place; true when it is
     * handed on, or there is nothing to hand on. A write refused later is
     * not waited for.
     */
    commit(): boolean;
    /**
     * Throw away what is typed and not handed on (a commit refused), the
     * field showing its value again and saying nothing: what a menu item
     * that puts a value in the field does first. Nothing for a field
     * whose text is handed on. None for a field no menu stands over.
     */
    drop?(): void;
}

const commits = new WeakMap<Element, FieldCommit>();

/** Say how `field` commits what is typed in it, until `signal` aborts (the field built anew). */
export function ownCommit(field: HTMLElement, commit: FieldCommit, signal?: AbortSignal): void {
    commits.set(field, commit);
    signal?.addEventListener('abort', () => {
        if (commits.get(field) === commit) commits.delete(field);
    });
}

/** How `field` commits what is typed in it; null for an element that commits nothing. */
export function commitOf(field: Element | null): FieldCommit | null {
    return (field && commits.get(field)) ?? null;
}

/** Give `button` the key of what it stands for, among the buttons of the surface it is in. */
export function pressKey(button: HTMLElement, key: string): void {
    button.dataset.press = key;
}

/** The key of what `button` stands for; undefined when it has none. */
export function keyOf(button: HTMLElement): string | undefined {
    return button.dataset.press;
}

/** The press under way in each document: the key of the button pressed, as the commits move it. */
const pressing = new WeakMap<Document, { key: string | null }>();

/**
 * Run `commit` for a press on the button keyed `key`: what it writes may
 * build the button anew, and move it ({@link carryPressKeys}).
 *
 * @returns what `commit` returned, and the key the button has once it ran;
 *   null when the commit took it out
 */
export function pressUnderWay<T>(doc: Document, key: string | null, commit: () => T): { result: T; key: string | null } {
    const press = { key };
    const outer = pressing.get(doc);
    pressing.set(doc, press);
    try {
        return { result: commit(), key: press.key };
    } finally {
        if (outer) pressing.set(doc, outer);
        else pressing.delete(doc);
    }
}

/**
 * Tell the press under way in `doc`, if any, where the buttons of a part
 * being written go once it is built anew: each key of `moves` goes to the
 * key it names, or out (null). A key not named stays as it is.
 */
export function carryPressKeys(doc: Document, moves: ReadonlyMap<string, string | null>): void {
    const press = pressing.get(doc);
    if (press?.key != null && moves.has(press.key)) press.key = moves.get(press.key) ?? null;
}

/** Each field's own buttons (its ×), by the button. */
const ownControls = new WeakMap<Element, Element>();
/** Each field menu's button, with the fields its items put a value in. */
const menusOver = new WeakMap<Element, () => readonly Element[]>();
/** The buttons that save or throw away what is typed on their own way. */
const takers = new WeakSet<Element>();
/** The buttons that change only what is shown: they act on a commit refused too. */
const showers = new WeakSet<Element>();
/** The parts whose presses are their own. */
const leftParts = new WeakSet<Element>();

/** Say that `button` is `field`'s own (the × that empties it): it acts on the field itself, in focus or not. */
export function ownControl(button: HTMLElement, field: HTMLElement): void {
    ownControls.set(button, field);
}

/**
 * Say that `button` opens a menu whose items put a value in `fields` (a
 * field's …; the due's date and time are one value). A commit of one of
 * them refused, it opens still, the text left as typed and why said under
 * it: opening throws nothing away and writes nothing, and an item picked
 * puts its own value in the text's stead ({@link FieldCommit.drop}). A
 * commit of another field refused, it does not act, as any button.
 */
export function menuOver(button: HTMLElement, fields: () => readonly Element[]): void {
    menusOver.set(button, fields);
}

/** Whether `button` acts though the commit of `field` before it is refused: it changes only what is shown, or it is a menu over the field. */
function actsRefused(button: Element, field: Element): boolean {
    return showers.has(button) || (menusOver.get(button)?.().includes(field) ?? false);
}

/**
 * Say that `button` saves what is typed, or throws it away, on its own way
 * (a close asking what to keep, a cancel, a move or a mode that saves what
 * is typed as it begins): a press on it commits no field first, which would
 * make a second way, and throw away nothing a discard is asked for.
 */
export function takesTyped(button: HTMLElement): void {
    takers.add(button);
}

/**
 * Say that `button` changes only what is shown (a tab, a line shown or
 * hidden): it changes no value and throws away nothing typed, so it acts
 * though the commit before it is refused, the text left in the field and
 * why said under it.
 */
export function showsOnly(button: HTMLElement): void {
    showers.add(button);
}

/** Say that the presses in `part` are its own (a card drawn in the surface): the surface reads none of them. */
export function leavePresses(part: HTMLElement): void {
    leftParts.add(part);
}

/** How a surface holds its presses ({@link holdPresses}). */
export interface PressHold {
    /** Draw at once what a commit had the surface draw later; nothing when it is drawn. */
    drawNow?(): void;
    /** Held until it aborts. */
    signal?: AbortSignal;
}

/**
 * Hold the presses on the buttons of `surface` (a `button`, or an element
 * with the role of one) while a field of it that text is typed in holds the
 * focus, typed in or not:
 *
 * - The button does not take the focus (its `mousedown`'s default is
 *   prevented): the field keeps it, and the on-screen keyboard stays.
 * - Clicked, what the field holds typed is committed as its Enter commits
 *   it (`ownCommit`), then the button acts. Refused at once, the button
 *   does not act: the focus and why stay with the field. A button that
 *   changes only what is shown (`showsOnly`) acts still, and so does a
 *   field's menu button over the field refused (`menuOver`). The commit may
 *   build the button anew (a list written): the button with its key now
 *   (`pressKey`, `carryPressKeys`) is pressed in its stead, so a button acts
 *   by its own click alone, as it is drawn now.
 * - The button is looked for once what the commit has the surface draw is
 *   drawn: a surface that draws a change later than it is handed on (in a
 *   microtask, which would come between this listener and the button's)
 *   draws it at once when asked (`drawNow`). A surface that draws it only
 *   once a write comes back leaves the button as it is drawn, on the value
 *   handed on, until then.
 * - A field's own × (`ownControl`) and a button that takes what is typed
 *   its own way (`takesTyped`) commit nothing first.
 *
 * A field that commits nothing (it is read as it is typed in) is committed
 * nothing; its buttons still take no focus. The presses of a part that
 * keeps its own (`leavePresses`) are not read.
 */
export function holdPresses(surface: HTMLElement, opts: PressHold = {}): void {
    const { drawNow, signal } = opts;
    const doc = surface.ownerDocument;
    surface.addEventListener('mousedown', (e) => {
        if (pressedIn(surface, e.target) && typingIn(surface, doc.activeElement)) e.preventDefault();
    }, { capture: true, signal });
    surface.addEventListener('click', (e) => {
        if (pressingAgain) return;
        const button = pressedIn(surface, e.target);
        const field = doc.activeElement;
        if (!button || takers.has(button) || !field || !surface.contains(field) || ownControls.get(button) === field) return;
        const owner = commitOf(field);
        if (!owner?.typed()) return;
        const { result, key } = pressUnderWay(doc, keyOf(button) ?? null, () => {
            const committed = owner.commit();
            drawNow?.();
            return committed;
        });
        if (!result) {
            if (!actsRefused(button, field)) e.stopImmediatePropagation();
            return;
        }
        if (surface.contains(button)) return;
        // Built anew: the button taken out acts no more, from what it was built on.
        e.stopImmediatePropagation();
        const again = key === null ? null : keyedIn(surface, key);
        if (!again) return;
        pressingAgain = true;
        try {
            again.click();
        } finally {
            pressingAgain = false;
        }
    }, { capture: true, signal });
}

/** Whether the button built anew is being pressed in the stead of the one a commit took out. */
let pressingAgain = false;

/** The button of `surface` that `target` is in, unless it is in a part that keeps its presses. */
function pressedIn(surface: HTMLElement, target: EventTarget | null): HTMLElement | null {
    let pressed: HTMLElement | null = null;
    for (let at = target as HTMLElement | null; at; at = at.parentElement) {
        if (at === surface) return pressed;
        if (leftParts.has(at)) return null;
        if (!pressed && (at.tagName === 'BUTTON' || at.getAttribute('role') === 'button')) pressed = at;
    }
    return null;
}

/** Whether `active` is a field of `surface` that text is typed in. */
function typingIn(surface: HTMLElement, active: Element | null): boolean {
    if (!active || !surface.contains(active)) return false;
    if (active.tagName === 'TEXTAREA') return true;
    // An input with no type, or one the browser does not know, is a text field.
    return active.tagName === 'INPUT' && !NOT_TEXT_TYPES.has((active.getAttribute('type') ?? '').toLowerCase());
}

/** The inputs no text is typed in: a picker's, a box, a range, a file, a button. */
const NOT_TEXT_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'color', 'checkbox', 'radio', 'range', 'file', 'button', 'submit', 'reset', 'image', 'hidden']);

/** The element of `surface` keyed `key`, the first in the order of the document. */
function keyedIn(surface: HTMLElement, key: string): HTMLElement | null {
    for (const child of Array.from(surface.children) as HTMLElement[]) {
        if (keyOf(child) === key) return child;
        const found = keyedIn(child, key);
        if (found) return found;
    }
    return null;
}
