/**
 * What a field naming a thing by its text holds of a candidate picked from
 * its list: the candidate, and the text the pick put in. The candidate is
 * picked while the field holds that text, since the field then says what it
 * said as the candidate was picked: while the text differs, the text is read
 * on its own, and once it is typed back (after a change, or after the field's
 * × and typing it again) the candidate is picked again. Picking anew replaces
 * it; a pick that names nothing leaves none.
 */
export class TextPick<T> {
    private held: { value: T; text: string } | null = null;

    /** Opened on `value` with `text` in the field, as a pick of it would be; null for none. */
    constructor(value: T | null, text: string) {
        this.pick(value, text);
    }

    /** `value` picked, the pick putting `text` in the field; null for a pick that names nothing. */
    pick(value: T | null, text: string): void {
        this.held = value === null ? null : { value, text };
    }

    /** What is picked while the field holds `text`. */
    of(text: string): T | null {
        return this.held !== null && this.held.text === text ? this.held.value : null;
    }
}
