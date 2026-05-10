/**
 * Window-scoped floating overlay container.
 *
 * Owns the DOM container element for a floating widget (timer widget today;
 * could be reused for other window-anchored overlays). Encapsulates:
 *   - container creation / disposal in a specific window's body
 *   - drag-to-move (pointer capture, viewport-relative coordinates)
 *   - resize-driven viewport clamp so the widget never gets stranded off-screen
 *   - drag-end notification used by the observer to defer window migration
 *
 * The widget's logical state (timers, intervals, render content) lives outside
 * this host, in plugin scope. attach()/detach() only move the DOM. Position
 * is preserved across attaches so a widget that was dragged in one window
 * keeps its coordinates when migrated to another (clamp re-runs against the
 * new viewport in case the destination window is smaller).
 */

const DEFAULT_OFFSET = 24;

export interface FloatingOverlayHostOptions {
    /**
     * Selectors inside the container whose clicks must not start a drag (they
     * are interactive: buttons, pin badge, inputs). The drag handler ignores
     * pointerdown when target.closest(selector) matches any of these.
     */
    nonDraggableSelectors: string[];
}

export class FloatingOverlayHost {
    private container: HTMLElement | null = null;
    private win: Window | null = null;
    private doc: Document | null = null;
    private resizeHandler: (() => void) | null = null;
    private dragging = false;
    private dragOffset = { x: 0, y: 0 };
    private onDragEndCb: (() => void) | null = null;
    /**
     * null = use CSS-default position (bottom-right corner). Once the user
     * drags the widget, an explicit {left, top} is recorded and re-applied
     * on every attach so the widget tracks the user's choice across windows.
     */
    private userPosition: { left: number; top: number } | null = null;

    constructor(private opts: FloatingOverlayHostOptions) {}

    attach(win: Window, doc: Document, className: string): HTMLElement {
        if (this.container) {
            // Defensive: previous attach was not balanced. Detach to keep
            // listeners and DOM consistent.
            this.detach();
        }
        this.win = win;
        this.doc = doc;
        this.container = doc.body.createDiv(className);
        this.applyPosition();
        this.setupDrag();
        this.resizeHandler = () => this.clampToViewport();
        win.addEventListener('resize', this.resizeHandler);
        // Clamp once after attach in case the new viewport is smaller than
        // the old one and the user-position would land off-screen.
        // Defer to next frame so layout (size) is stable.
        win.requestAnimationFrame(() => this.clampToViewport());
        return this.container;
    }

    detach(): void {
        if (this.win && this.resizeHandler) {
            this.win.removeEventListener('resize', this.resizeHandler);
        }
        if (this.container) {
            this.container.remove();
        }
        this.container = null;
        this.win = null;
        this.doc = null;
        this.resizeHandler = null;
        this.dragging = false;
    }

    getContainer(): HTMLElement | null {
        return this.container;
    }

    getWin(): Window | null {
        return this.win;
    }

    getDoc(): Document | null {
        return this.doc;
    }

    isDragInProgress(): boolean {
        return this.dragging;
    }

    /**
     * Called whenever a drag completes. Used by the observer to flush a
     * deferred window migration that was queued during the drag.
     */
    setOnDragEnd(cb: (() => void) | null): void {
        this.onDragEndCb = cb;
    }

    clampToViewport(): void {
        if (!this.container || !this.win || !this.userPosition) return;
        const rect = this.container.getBoundingClientRect();
        const winW = Math.max(rect.width + 16, this.win.innerWidth);
        const winH = Math.max(rect.height + 16, this.win.innerHeight);
        let { left, top } = this.userPosition;
        if (left + rect.width > winW - 8) left = winW - rect.width - 8;
        if (top + rect.height > winH - 8) top = winH - rect.height - 8;
        left = Math.max(8, left);
        top = Math.max(8, top);
        if (left !== this.userPosition.left || top !== this.userPosition.top) {
            this.userPosition = { left, top };
            this.applyPosition();
        }
    }

    private applyPosition(): void {
        if (!this.container) return;
        if (this.userPosition) {
            this.container.style.left = `${this.userPosition.left}px`;
            this.container.style.top = `${this.userPosition.top}px`;
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        } else {
            // Default corner-anchored position: keep the badge inside the
            // viewport since it sticks out beyond the widget's border.
            this.container.style.right = `${DEFAULT_OFFSET}px`;
            this.container.style.bottom = `${DEFAULT_OFFSET}px`;
            this.container.style.left = '';
            this.container.style.top = '';
        }
    }

    private setupDrag(): void {
        if (!this.container) return;
        const header = this.container;

        header.addEventListener('pointerdown', (e) => {
            const target = e.target as HTMLElement;
            for (const sel of this.opts.nonDraggableSelectors) {
                if (target.closest(sel)) return;
            }

            this.dragging = true;
            const rect = this.container!.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            this.container!.style.cursor = 'grabbing';
            header.setPointerCapture(e.pointerId);
        });

        header.addEventListener('pointermove', (e) => {
            if (!this.dragging || !this.container) return;
            const left = e.clientX - this.dragOffset.x;
            const top = e.clientY - this.dragOffset.y;
            this.userPosition = { left, top };
            this.applyPosition();
        });

        const endDrag = (e: PointerEvent) => {
            if (!this.dragging) return;
            this.dragging = false;
            if (this.container) this.container.style.cursor = 'grab';
            try {
                header.releasePointerCapture(e.pointerId);
            } catch {
                // Capture may already be released if pointer left the window.
            }
            this.clampToViewport();
            this.onDragEndCb?.();
        };
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);
    }
}
