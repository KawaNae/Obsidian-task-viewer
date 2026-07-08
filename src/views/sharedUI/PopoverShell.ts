/**
 * Popout-aware popover primitive.
 *
 * Owns one floating popover element: creation in the host window's body,
 * positioning relative to an anchor, reposition on host window resize,
 * optional Escape key handling, and disposal. Outside-click handling is
 * deliberately NOT here — see PopoverStack which centralises it across the
 * stack so that clicks on a child popover don't close its parent.
 *
 * Host document/window are resolved from the anchor (HTMLElement.ownerDocument
 * or MouseEvent.target.ownerDocument). Callers never pass `document`/`window`
 * explicitly, which prevents the popout-blindness regression where a popover
 * leaks back to the main window.
 */

export type PopoverAnchor =
    | { kind: 'element'; element: HTMLElement; placement?: 'below' }
    | { kind: 'event'; event: MouseEvent };

export interface PopoverOpenOpts {
    anchor: PopoverAnchor;
    className: string;
    build: (el: HTMLElement) => void;
    /** Called when the shell closes for any reason (outside-click, escape, host-close, manual). */
    onClose?: () => void;
    /** When provided, Escape on the host window calls this and closes the shell. */
    onEscape?: () => void;
    /**
     * Additional elements that count as "inside" this popover when the stack
     * tests outside-clicks. Used by suggest-style popovers whose anchor (an
     * input field) must keep the suggest list open even when re-focused.
     */
    extraContains?: HTMLElement[];
}

export class PopoverShell {
    private el: HTMLElement | null = null;
    private hostDoc: Document | null = null;
    private hostWin: Window | null = null;
    private anchor: PopoverAnchor | null = null;
    private onCloseCb: (() => void) | null = null;
    private onEscapeCb: (() => void) | null = null;
    private resizeHandler: (() => void) | null = null;
    private vvResizeHandler: (() => void) | null = null;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private pageHideHandler: (() => void) | null = null;
    private extraContains: HTMLElement[] = [];

    open(opts: PopoverOpenOpts): void {
        if (this.isOpen()) this.close();

        const { hostDoc, hostWin } = resolveHost(opts.anchor);
        this.hostDoc = hostDoc;
        this.hostWin = hostWin;
        this.anchor = opts.anchor;
        this.onCloseCb = opts.onClose ?? null;
        this.onEscapeCb = opts.onEscape ?? null;
        this.extraContains = opts.extraContains ? [...opts.extraContains] : [];

        this.el = hostDoc.createElement('div');
        this.el.className = opts.className;
        opts.build(this.el);
        hostDoc.body.appendChild(this.el);
        this.reposition();

        this.resizeHandler = () => this.reposition();
        hostWin.addEventListener('resize', this.resizeHandler);

        const vv = hostWin.visualViewport;
        if (vv) {
            this.vvResizeHandler = () => this.reposition();
            vv.addEventListener('resize', this.vvResizeHandler);
        }

        // Auto-close when the host window is being unloaded (popout closed).
        // Fires before document destruction so cleanup callbacks still run.
        this.pageHideHandler = () => this.close();
        hostWin.addEventListener('pagehide', this.pageHideHandler);

        if (this.onEscapeCb) {
            this.escapeHandler = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    this.onEscapeCb?.();
                }
            };
            hostDoc.addEventListener('keydown', this.escapeHandler, true);
        }
    }

    close(): void {
        if (!this.el || !this.hostWin || !this.hostDoc) return;

        if (this.resizeHandler) {
            this.hostWin.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        if (this.vvResizeHandler && this.hostWin.visualViewport) {
            this.hostWin.visualViewport.removeEventListener('resize', this.vvResizeHandler);
            this.vvResizeHandler = null;
        }
        if (this.pageHideHandler) {
            this.hostWin.removeEventListener('pagehide', this.pageHideHandler);
            this.pageHideHandler = null;
        }
        if (this.escapeHandler) {
            this.hostDoc.removeEventListener('keydown', this.escapeHandler, true);
            this.escapeHandler = null;
        }

        this.el.remove();
        this.el = null;
        this.hostDoc = null;
        this.hostWin = null;
        this.anchor = null;
        this.extraContains = [];

        const cb = this.onCloseCb;
        this.onCloseCb = null;
        this.onEscapeCb = null;
        cb?.();
    }

    isOpen(): boolean {
        return this.el !== null;
    }

    /**
     * Replace popover content in place. Position is preserved (no reposition).
     * Used for internal refreshes that must not visually shift the popover.
     */
    refresh(build: (el: HTMLElement) => void): void {
        if (!this.el) return;
        this.el.empty();
        build(this.el);
    }

    /** Recompute position from the original anchor. Called on resize. */
    reposition(): void {
        if (!this.el || !this.hostWin || !this.anchor) return;
        positionElement(this.el, this.anchor, this.hostWin);
    }

    contains(target: Node): boolean {
        if (this.el?.contains(target)) return true;
        for (const extra of this.extraContains) {
            if (extra.contains(target)) return true;
        }
        return false;
    }

    getEl(): HTMLElement | null {
        return this.el;
    }

    getHostDoc(): Document | null {
        return this.hostDoc;
    }

    getHostWin(): Window | null {
        return this.hostWin;
    }
}

function resolveHost(anchor: PopoverAnchor): { hostDoc: Document; hostWin: Window } {
    let node: Node | null = null;
    if (anchor.kind === 'element') {
        node = anchor.element;
    } else {
        node = (anchor.event.target as Node | null) ?? null;
    }
    const hostDoc = (node?.ownerDocument as Document | null) ?? document;
    const hostWin = (hostDoc.defaultView as Window | null) ?? window;
    return { hostDoc, hostWin };
}

function positionElement(el: HTMLElement, anchor: PopoverAnchor, hostWin: Window): void {
    // Element must be in DOM with content to measure. Caller guarantees this
    // because positionElement is only invoked after open()/refresh().
    const rect = el.getBoundingClientRect();
    const winW = Math.max(0, hostWin.innerWidth);
    const vvH = hostWin.visualViewport?.height ?? hostWin.innerHeight;
    const winH = Math.max(0, Math.min(hostWin.innerHeight, vvH));

    let x: number;
    let y: number;
    if (anchor.kind === 'element') {
        const aRect = anchor.element.getBoundingClientRect();
        // Use scrollX/Y of the host window so popover stays anchored on scroll.
        x = aRect.left + hostWin.scrollX;
        y = aRect.bottom + 4 + hostWin.scrollY;
        // Flip above if no room below.
        if (y + rect.height > winH + hostWin.scrollY) {
            y = aRect.top - rect.height - 4 + hostWin.scrollY;
        }
    } else {
        x = anchor.event.pageX;
        y = anchor.event.pageY;
    }

    if (x + rect.width > winW + hostWin.scrollX) {
        x = winW + hostWin.scrollX - rect.width - 8;
    }
    if (y + rect.height > winH + hostWin.scrollY) {
        y = winH + hostWin.scrollY - rect.height - 8;
    }

    el.style.left = `${Math.max(8 + hostWin.scrollX, x)}px`;
    el.style.top = `${Math.max(8 + hostWin.scrollY, y)}px`;
}
