/**
 * The one answer to "is this Enter the form's?" (submit, commit, pick), for
 * every field of ours: an input, a textarea, a button that stands for a
 * value (the hub's status pill).
 *
 * An Enter that an IME uses to commit a conversion or pick a candidate is
 * not the form's: the conversion is committed by it, and the next Enter is
 * the form's. Browsers send that Enter in three ways:
 *
 * - Chromium on macOS: `key` 'Enter' with `isComposing` true
 * - Safari and WebKit (iPad, iPhone): the composition ends first
 *   (`compositionend`), then `key` 'Enter' with `isComposing` false and
 *   `keyCode` 229
 * - Chromium on Windows: `key` 'Process' while composing
 *
 * An Enter a list open on the field takes (Obsidian's input suggest picking
 * its highlighted item) is not the form's either: `takesEnter` says so.
 */

/**
 * Whether a keydown is an Enter the form should act on. `composing` is a
 * field's own composition flag (`compositionstart` to `compositionend`),
 * which {@link onFormEnter} keeps for each field.
 */
export function isFormEnter(e: KeyboardEvent, composing = false): boolean {
    return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !composing;
}

/** Whether a field is between `compositionstart` and `compositionend`; one per field. */
const compositions = new WeakMap<HTMLElement, { composing: boolean }>();

function compositionOf(field: HTMLElement): { composing: boolean } {
    let state = compositions.get(field);
    if (!state) {
        const made = { composing: false };
        field.addEventListener('compositionstart', () => { made.composing = true; });
        field.addEventListener('compositionend', () => { made.composing = false; });
        compositions.set(field, made);
        state = made;
    }
    return state;
}

/**
 * Whether the IME is composing in `field` now (between `compositionstart`
 * and `compositionend`): a value from outside is not put in then, or it
 * would replace what is being converted (`bindField`).
 */
export function composingIn(field: HTMLElement): boolean {
    return compositionOf(field).composing;
}

/**
 * Call `run` on the field's Enters that are the form's, and on no other key.
 * The Enter's default (a newline in a textarea, a click on a button) is
 * prevented then, as the form takes the key; an Enter that is not the
 * form's is left to the IME or the list it is for.
 *
 * Several handlers on one field run in the order they were put on.
 *
 * @param opts.takesEnter whether a list open on the field takes this Enter
 *   (an input suggest showing its list: `ShownSuggest.listShown`)
 * @returns a function that takes the handler off
 */
export function onFormEnter(
    field: HTMLElement,
    run: (e: KeyboardEvent) => void,
    opts: { takesEnter?: () => boolean } = {},
): () => void {
    const composition = compositionOf(field);
    const onKey = (e: KeyboardEvent) => {
        if (!isFormEnter(e, composition.composing)) return;
        if (opts.takesEnter?.()) return;
        e.preventDefault();
        run(e);
    };
    field.addEventListener('keydown', onKey);
    return () => field.removeEventListener('keydown', onKey);
}
