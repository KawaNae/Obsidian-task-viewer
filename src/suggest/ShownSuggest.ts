import { AbstractInputSuggest } from 'obsidian';

/**
 * An input's suggest that says whether its list is open: an Enter then picks
 * from the list, and a form the input is in does not take it as its own.
 * Not `isOpen`, which Obsidian's PopoverSuggest sets as its own (untyped)
 * field.
 */
export abstract class ShownSuggest<T> extends AbstractInputSuggest<T> {
    private shown = false;

    /** Whether the list is open. */
    get listShown(): boolean {
        return this.shown;
    }

    open(): void {
        super.open();
        this.shown = true;
    }

    close(): void {
        super.close();
        this.shown = false;
    }
}
