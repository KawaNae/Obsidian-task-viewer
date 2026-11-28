import type { App } from 'obsidian';
import { ShownSuggest } from './ShownSuggest';

/** What a {@link ValueSuggest} offers, how it draws an item, and what picking one does. */
export interface ValueSuggestOptions {
    /** The values offered for what the field holds (its whole text). */
    candidates(query: string): readonly string[];
    /** Draw a value's item; its text by default. */
    render?(value: string, el: HTMLElement): void;
    /**
     * A value was picked from the list, which has closed. What it means is
     * the field's: put it in and commit it (`BoundField.commit`), add it as
     * a pill, move on to the next field.
     */
    pick(value: string): void;
}

/**
 * The list of values under a text field of ours: the hub's tags, style and
 * properties, the filter's keys, values and pills, the top-right fields of
 * a list. One kind of list for every field, Obsidian's (`ShownSuggest`), as
 * the name's links and tags are: on a field that holds text the first item
 * is selected as it opens, an Enter puts the selected item in, and a value
 * that is no item is put in by closing the list (Escape) and pressing
 * Enter, as the editor's lists do. On an empty field none is selected, and
 * an Enter is the field's, as it is with the list closed.
 *
 * The field's own Enter (`onFormEnter`, `bindField`) never sees an Enter
 * the list takes: Obsidian's keymap takes it before the field does. An
 * Enter with no item selected closes the list first and reaches the field
 * then. What is picked is committed by {@link ValueSuggestOptions.pick},
 * not by the order the field's listeners were put on.
 */
export class ValueSuggest extends ShownSuggest<string> {
    constructor(app: App, input: HTMLInputElement, private readonly opts: ValueSuggestOptions) {
        super(app, input);
    }

    protected getSuggestions(query: string): string[] {
        return [...this.opts.candidates(query)];
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        if (this.opts.render) this.opts.render(value, el);
        else el.setText(value);
    }

    protected pick(value: string): void {
        this.close();
        this.opts.pick(value);
    }
}
