import { AbstractInputSuggest, type App } from 'obsidian';
import { composingIn, isFormEnter } from '../modals/form/formEnter';

/**
 * Obsidian's input suggest, as every list of candidates under a field of
 * ours is shown, so that a field's list and the editor's own behave alike.
 * It behaves as Obsidian's lists do:
 * the first item is selected as the list opens, an Enter puts the selected
 * item in, an Escape closes the list alone; a value that is no item is
 * put in by closing the list (Escape) and pressing Enter.
 *
 * Over Obsidian's, it answers four things:
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
 * - The list stays on its field while the field moves. Obsidian places the
 *   list by the field and within the room it keeps the list in (the
 *   window, less the safe areas: on Android the keyboard's height while it
 *   is up) as it opens and as the field is typed in, and places it anew on
 *   a scroll only; a field that moves otherwise (the keyboard grows or
 *   shrinks the dialog, a message under the field changes the dialog's
 *   height, the window is resized) leaves the list where it was. The DOM
 *   tells nothing of an element that moves, so while the list is open what
 *   Obsidian places it by ({@link placedBy}) is read on every frame of the
 *   field's window, and once it changed the list is opened again
 *   ({@link open}), which places it as typing does and keeps the selected
 *   item, the list's scroll, and what a subclass adds as it opens.
 *
 * A subclass says what picking an item does in {@link pick}.
 */
export abstract class ShownSuggest<T> extends AbstractInputSuggest<T> {
    private shown = false;
    /** While the list is open: the frame to come, and what the list was last placed by ({@link placedBy}). */
    private following: { win: Window; frame: number; placedBy: string } | null = null;

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
        this.follow();
    }

    close(): void {
        this.unfollow();
        super.close();
        this.shown = false;
    }

    /**
     * Obsidian's `open` has just placed the list: what it placed it by is
     * the one to compare with. Obsidian opens the list on every key typed,
     * and a frame here opens it too; the frames already coming go on, and
     * no second run of them begins.
     */
    private follow(): void {
        const placedBy = this.placedBy();
        if (this.following) {
            this.following.placedBy = placedBy;
            return;
        }
        // The field's window: a popout window paints its own frames.
        const win = this.listField.ownerDocument.defaultView ?? window;
        this.following = { win, frame: win.requestAnimationFrame(this.onFrame), placedBy };
    }

    private unfollow(): void {
        if (!this.following) return;
        this.following.win.cancelAnimationFrame(this.following.frame);
        this.following = null;
    }

    private readonly onFrame = (): void => {
        const following = this.following;
        if (!following) return;
        following.frame = following.win.requestAnimationFrame(this.onFrame);
        // A field taken out of the page is Obsidian's to close (it closes a
        // list whose field is gone); its empty place is no place to put the list by.
        if (!this.listField.isConnected) return;
        if (this.placedBy() === following.placedBy) return;
        this.open();
    };

    /**
     * What Obsidian 1.14.5 and 1.15.0 place the list by, as one value to
     * compare: the field's place, and the room the list is kept in, which
     * is the list's offset parent (or the root) with its place, scroll and
     * size, less the `--safe-area-inset-*` it holds, within the window.
     * Android's keyboard is in the bottom safe area while it is up, and on
     * closing the keyboard that area shrinks a frame after the dialog has
     * moved the field down.
     *
     * This is Obsidian's unpublished placement read from outside. Should
     * Obsidian place the list by more than this, a change in that alone
     * leaves the list where it was until the field moves.
     */
    private placedBy(): string {
        const field = this.listField.getBoundingClientRect();
        // @ts-ignore - suggestEl is the list's container (internal but stable)
        const list: HTMLElement | undefined = this.suggestEl;
        const doc = this.listField.ownerDocument;
        const room = (list?.offsetParent as HTMLElement | null | undefined) ?? doc.documentElement;
        const roomAt = room.getBoundingClientRect();
        const win = doc.defaultView ?? window;
        const style = win.getComputedStyle(room);
        return [
            field.top, field.bottom, field.left, field.right,
            roomAt.top, roomAt.bottom, roomAt.left, roomAt.right,
            room.scrollTop, room.scrollLeft, room.clientWidth, room.clientHeight,
            style.getPropertyValue('--safe-area-inset-top'),
            style.getPropertyValue('--safe-area-inset-bottom'),
            style.getPropertyValue('--safe-area-inset-left'),
            style.getPropertyValue('--safe-area-inset-right'),
            // Obsidian reads the width of the list's window, and the height
            // of the main window (its own `window`, a popout's too).
            win.innerWidth, window.innerHeight,
        ].join(' ');
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
