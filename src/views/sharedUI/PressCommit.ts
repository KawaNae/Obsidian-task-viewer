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
