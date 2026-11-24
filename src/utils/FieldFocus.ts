/**
 * Putting the focus on a field, and meeting its text as the field's kind
 * asks: all of it selected, or the caret after it.
 */

/**
 * What takes a focus: an element, or a part of a form that focuses itself
 * (a CodeMirror editor, which puts its own caret).
 */
export interface Focusable {
    focus(options?: FocusOptions): void;
}

/**
 * How a text field's text is met as the focus comes to it.
 *
 * - `'all'`: all of it selected, so what is typed replaces it: a value of
 *   fixed shape (a date, a time, a line style, a colour, a number), which
 *   is retyped whole.
 * - `'end'`: the caret after it, so a free text is added to or mended
 *   without its being replaced by a slip of the key (a name, a tag, a
 *   note's or a heading's name, which has no fixed shape).
 */
export type SelectionOnFocus = 'all' | 'end';

/** Where a focus goes, and how its text is met there; with no `selection`, the focus alone (a button, an editor). */
export interface FieldFocus {
    to: Focusable;
    selection?: SelectionOnFocus;
}

/**
 * Focus `to`, and meet its text as `selection` says, once the focus has
 * come to it (an element hidden or disabled does not take it, and is left
 * as it is). What holds no text to select (a button, an editor) is focused only.
 */
export function focusField({ to, selection }: FieldFocus, options?: FocusOptions): void {
    to.focus(options);
    if (!selection) return;
    const field = to as Partial<HTMLInputElement>;
    if (field.ownerDocument?.activeElement !== (to as unknown)) return;
    if (selection === 'all') {
        if (typeof field.select === 'function') field.select();
        return;
    }
    putCaretAtEnd(field);
}

/**
 * The caret after the text, the field's own text scrolled for its end to
 * show (a long name in a narrow field). Only the field scrolls: what it
 * stands in does not move. A field that holds no caret (a colour's, a
 * date's native input) is left as it is.
 */
function putCaretAtEnd(field: Partial<HTMLInputElement>): void {
    if (typeof field.value !== 'string' || typeof field.setSelectionRange !== 'function') return;
    if (field.selectionStart === null) return;
    const end = field.value.length;
    field.setSelectionRange(end, end);
    if (typeof field.scrollWidth === 'number') field.scrollLeft = field.scrollWidth;
    if (typeof field.scrollHeight === 'number') field.scrollTop = field.scrollHeight;
}
