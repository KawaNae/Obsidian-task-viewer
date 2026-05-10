/**
 * Stack of PopoverShells with shared outside-click handling.
 *
 * One stack per UI component (FilterMenuComponent, SortMenuComponent, etc.).
 * Within a stack, opening a child popover (e.g. a dropdown inside a filter
 * popover) appends a shell on top of the parent. Outside-click is computed
 * stack-wide: a click that lands inside ANY shell in the stack only closes
 * shells above the matched one; a click outside all shells closes everything.
 *
 * This eliminates the previous selector-based exclusion (".filter-child-popover")
 * by which parents had to know their children's class names.
 */

import { PopoverShell, PopoverOpenOpts } from './PopoverShell';

export class PopoverStack {
    private shells: PopoverShell[] = [];
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private hostDoc: Document | null = null;

    openRoot(opts: PopoverOpenOpts): PopoverShell {
        this.closeAll();
        return this.pushShell(opts);
    }

    /**
     * Open a popover on top of the current stack. If no shell exists yet, this
     * behaves like openRoot. Any existing shells above the current top (i.e.
     * sibling children opened previously) are closed first to keep the stack
     * a strict ancestor chain.
     */
    openChild(opts: PopoverOpenOpts): PopoverShell {
        // Close any existing top-level child to avoid sibling stacking.
        if (this.shells.length >= 2) {
            this.closeFromIndex(1);
        }
        return this.pushShell(opts);
    }

    /** Close `shell` and all shells opened after it. */
    close(shell: PopoverShell): void {
        const idx = this.shells.indexOf(shell);
        if (idx < 0) return;
        this.closeFromIndex(idx);
    }

    closeAll(): void {
        if (this.shells.length === 0) return;
        this.closeFromIndex(0);
    }

    isOpen(): boolean {
        return this.shells.length > 0;
    }

    getRoot(): PopoverShell | null {
        return this.shells[0] ?? null;
    }

    getTop(): PopoverShell | null {
        return this.shells[this.shells.length - 1] ?? null;
    }

    private pushShell(opts: PopoverOpenOpts): PopoverShell {
        const shell = new PopoverShell();

        // Wrap user onClose so the stack drops the shell when it self-closes
        // (escape, pagehide, manual close()).
        const userOnClose = opts.onClose;
        const wrappedOnClose = () => {
            const i = this.shells.indexOf(shell);
            if (i >= 0) this.shells.splice(i, 1);
            if (this.shells.length === 0) this.detachOutsideClick();
            userOnClose?.();
        };

        shell.open({ ...opts, onClose: wrappedOnClose });

        const newDoc = shell.getHostDoc();
        if (newDoc && newDoc !== this.hostDoc) {
            // Outside-click listener lives on the host document. If a child
            // somehow opens in a different host than the root we re-attach
            // there; in practice all shells in one stack share a host.
            this.detachOutsideClick();
            this.hostDoc = newDoc;
        }

        this.shells.push(shell);

        if (!this.outsideClickHandler && this.hostDoc) {
            this.attachOutsideClick(this.hostDoc);
        }

        return shell;
    }

    private closeFromIndex(idx: number): void {
        // Iterate from top downward so wrappedOnClose splice indices stay
        // valid as we go; each shell.close() removes itself via the wrapper.
        for (let i = this.shells.length - 1; i >= idx; i--) {
            // Take a stable reference; close() will splice from this.shells.
            this.shells[i].close();
        }
    }

    private attachOutsideClick(doc: Document): void {
        this.outsideClickHandler = (e: MouseEvent) => {
            const target = e.target as Node;
            // Walk top-down: find the topmost shell containing the target.
            for (let i = this.shells.length - 1; i >= 0; i--) {
                if (this.shells[i].contains(target)) {
                    // Close shells above the matched one.
                    if (i + 1 < this.shells.length) {
                        this.closeFromIndex(i + 1);
                    }
                    return;
                }
            }
            this.closeAll();
        };
        // Capture phase: catch the click before any in-popover handlers
        // (which typically stopPropagation).
        doc.addEventListener('pointerdown', this.outsideClickHandler, true);
    }

    private detachOutsideClick(): void {
        if (this.outsideClickHandler && this.hostDoc) {
            this.hostDoc.removeEventListener('pointerdown', this.outsideClickHandler, true);
        }
        this.outsideClickHandler = null;
        this.hostDoc = null;
    }
}
