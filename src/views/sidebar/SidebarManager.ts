/**
 * Stateless DOM helper for a right-side sidebar panel.
 *
 * Does NOT own open/close state — the view's own state (e.g. viewState.showSidebar)
 * is the single source of truth. SidebarManager only applies CSS classes and
 * delegates user-initiated close requests back to the view via `onRequestClose`.
 *
 * Designed for composition — each view instantiates its own SidebarManager
 * and delegates layout/DOM concerns to it.
 */

export interface SidebarManagerConfig {
    mobileBreakpointPx: number;
    onPersist: () => void;
    onSyncToggleButton?: () => void;
    /** Called when the user closes the sidebar via backdrop click or Escape key. */
    onRequestClose: () => void;
    /** Returns the current open/close state from the view's state. */
    getIsOpen: () => boolean;
}

export class SidebarManager {
    private containerEl: HTMLElement | null = null;
    private layoutEl: HTMLElement | null = null;
    private mainEl: HTMLElement | null = null;
    private sidebarEl: HTMLElement | null = null;
    private backdropEl: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(private config: SidebarManagerConfig) {}

    // ----- Lifecycle -----

    /**
     * Call once in onOpen(). Sets up ResizeObserver and Escape key handler.
     * `registerDomEvent` should be the view's own registerDomEvent so that
     * Obsidian automatically cleans up listeners on view close.
     */
    attach(
        container: HTMLElement,
        registerDomEvent: (el: HTMLElement | Window | Document, event: string, handler: (e: Event) => void) => void,
    ): void {
        this.containerEl = container;

        this.resizeObserver = new ResizeObserver(() => {
            this.applyOpen(this.config.getIsOpen(), { animate: false });
        });
        this.resizeObserver.observe(container);

        const win = container.win ?? window;
        registerDomEvent(win, 'keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape' && this.config.getIsOpen()) {
                event.preventDefault();
                this.config.onRequestClose();
            }
        });
    }

    /** Call in onClose(). Disconnects ResizeObserver. */
    detach(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }

    // ----- DOM Building -----

    /**
     * Creates the sidebar layout DOM inside `parent`.
     * Call every render cycle (after parent.empty()).
     *
     * Returns references to the main content area, sidebar header, and sidebar body
     * so the view can render its own content into them.
     */
    buildLayout(parent: HTMLElement): {
        main: HTMLElement;
        sidebarHeader: HTMLElement;
        sidebarBody: HTMLElement;
    } {
        const layout = parent.createDiv('tv-sidebar');
        this.layoutEl = layout;

        const main = layout.createDiv('tv-sidebar__main');
        this.mainEl = main;

        const backdrop = layout.createDiv('tv-sidebar__backdrop');
        backdrop.addEventListener('click', () => {
            if (this.config.getIsOpen()) {
                this.config.onRequestClose();
            }
        });
        this.backdropEl = backdrop;

        const sidebar = layout.createDiv('tv-sidebar__panel');
        this.sidebarEl = sidebar;

        const sidebarHeader = sidebar.createDiv('tv-sidebar__panel-header');
        const sidebarBody = sidebar.createDiv('tv-sidebar__panel-body');

        // Apply current open/closed state to freshly created elements
        this.syncPresentation(this.config.getIsOpen(), { animate: false });

        return { main, sidebarHeader, sidebarBody };
    }

    // ----- DOM Application -----

    /**
     * Apply the given open/close state to the DOM.
     * Call after changing the view's sidebar state to update CSS classes.
     */
    applyOpen(
        isOpen: boolean,
        options?: { animate?: boolean; persist?: boolean },
    ): void {
        const animate = options?.animate ?? false;
        this.syncPresentation(isOpen, { animate });
        if (options?.persist) {
            this.config.onPersist();
        }
    }

    /**
     * Synchronize CSS classes for the given open/close state.
     */
    syncPresentation(isOpen: boolean, options: { animate: boolean }): void {
        this.applyResponsiveLayout();

        if (this.layoutEl) {
            this.layoutEl.classList.toggle('tv-sidebar--animate', options.animate);
        }
        if (this.sidebarEl) {
            this.sidebarEl.classList.toggle('tv-sidebar__panel--hidden', !isOpen);
        }
        if (this.mainEl) {
            this.mainEl.classList.toggle('tv-sidebar__main--open', isOpen);
        }
        if (this.backdropEl) {
            this.backdropEl.classList.toggle('tv-sidebar__backdrop--visible', isOpen);
        }
        this.config.onSyncToggleButton?.();
    }

    /** Whether the container is currently at or below the mobile breakpoint. */
    isNarrow(): boolean {
        if (!this.containerEl) return false;
        const width = this.containerEl.clientWidth;
        if (width <= 0) return false;
        return width <= this.config.mobileBreakpointPx;
    }

    // ----- Private Helpers -----

    private applyResponsiveLayout(): void {
        if (!this.containerEl) return;
        const width = this.containerEl.clientWidth;
        if (width <= 0) return; // Hidden tabs can report 0

        const isNarrow = width <= this.config.mobileBreakpointPx;
        this.layoutEl?.classList.toggle('tv-sidebar--mobile', isNarrow);
    }
}
