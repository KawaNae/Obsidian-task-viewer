import { AbstractInputSuggest, type App } from 'obsidian';
import { composingIn, isFormEnter } from '../modals/form/formEnter';

/**
 * Obsidian's input suggest, as every list of candidates under a field of
 * ours is shown (段10f, 論点5, 論点A). It behaves as Obsidian's lists do:
 * the first item is selected as the list opens, an Enter puts the selected
 * item in, an Escape closes the list alone; a value that is no item is
 * put in by closing the list (Escape) and pressing Enter.
 *
 * Over Obsidian's, it answers three things:
 *
 * - Whether the list is open ({@link listShown}): an Enter then picks from
 *   the list, and a form the input is in does not take it as its own. Not
 *   `isOpen`, which Obsidian's PopoverSuggest sets as its own (untyped)
 *   field.
 * - The note's hotkeys are kept out while the list is open. The list's
 *   scope has Obsidian's app scope as its parent, so a key the list does
 *   not take (Mod+B) would fall through to the hotkeys and act on the note
 *   behind, past the scope our overlays push (`HotkeyShield`). A last
 *   handler takes every other key: it answers `true`, which stops the
 *   lookup without preventing the key's default, so the key still types.
 * - An Enter an IME commits a conversion with picks nothing
 *   (`isFormEnter`): Obsidian's list skips only an Enter with
 *   `isComposing`, and WebKit (iPad, iPhone) sends the committing Enter
 *   after the composition ended, with `keyCode` 229.
 *
 * A subclass says what picking an item does in {@link pick}.
 */
export abstract class ShownSuggest<T> extends AbstractInputSuggest<T> {
    private shown = false;

    constructor(app: App, private readonly listField: HTMLInputElement | HTMLDivElement) {
        super(app, listField);
        // After Obsidian's own keys (the arrows, Enter, Escape): the rest.
        this.scope.register(null, null, () => true);
    }

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

    /** Obsidian's pick, by a click or by an Enter that is the form's: {@link pick}. */
    selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
        // Not `instanceof KeyboardEvent`: a popout window has its own.
        if (evt.type === 'keydown' && !isFormEnter(evt as KeyboardEvent, composingIn(this.listField))) return;
        this.pick(value, evt);
    }

    /** An item was picked. */
    protected abstract pick(value: T, evt: MouseEvent | KeyboardEvent): void;
}
