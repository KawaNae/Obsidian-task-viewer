import { Scope, type Keymap } from 'obsidian';

/**
 * Keeps Obsidian's hotkeys out of a surface of our own while the focus is in
 * it, as a modal of Obsidian's keeps them out: a scope with no parent is
 * pushed, so no hotkey is looked up, and the keys go on to what has the
 * focus (a text field, a CodeMirror editor) and to the surface's own
 * listeners (an overlay's Escape). Without it, a hotkey pressed in a field
 * of ours acts on the note of the active tab behind (Mod+B makes its text
 * bold, Mod+W closes its tab, Mod+Enter opens the link under its cursor).
 *
 * "In it" is where the focus last went: a focus that moves into the surface
 * pushes the scope, one that moves to an element outside it pops the scope.
 * A focus that goes to no element (a click on the surface's blank space,
 * the window left) moves nothing, so the scope stays as it was.
 */
export class HotkeyShield {
    private readonly scope = new Scope();
    private pushed = false;
    private readonly onFocusIn = (e: FocusEvent) => this.keepOut(this.holds(e.target as Node | null));

    /**
     * @param keymap Obsidian's keymap (`app.keymap`)
     * @param doc the document the surface is in
     * @param holds whether a node is in the surface (its child popovers among it)
     */
    constructor(
        private readonly keymap: Keymap,
        private readonly doc: Document,
        private readonly holds: (node: Node | null) => boolean,
    ) {
        doc.addEventListener('focusin', this.onFocusIn, true);
        this.keepOut(holds(doc.activeElement));
    }

    /** Pop the scope, if pushed, and stop following the focus. */
    detach(): void {
        this.doc.removeEventListener('focusin', this.onFocusIn, true);
        this.keepOut(false);
    }

    private keepOut(on: boolean): void {
        if (this.pushed === on) return;
        this.pushed = on;
        if (on) this.keymap.pushScope(this.scope);
        else this.keymap.popScope(this.scope);
    }
}
