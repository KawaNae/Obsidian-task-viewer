/**
 * Manages a right-side sidebar panel: DOM creation, open/close state,
 * CSS class toggling, animation, responsive layout, and keyboard handling.
 *
 * Designed for composition — each view instantiates its own SidebarManager
 * and delegates layout/state concerns to it.
 */

export type SidebarToggleSource =
    | 'toolbar'
    | 'backdrop'
    | 'escape'
    | 'render'
    | 'setState'
    | 'resize'
    | 'layout-restore';

export interface SidebarManagerConfig {
    mobileBreakpointPx: number;
    onPersist: () => void;
    onSyncToggleButton?: () => void;
}

export class SidebarManager {
    private _isOpen: boolean;
    private containerEl: HTMLElement | null = null;
    private layoutEl: HTMLElement | null = null;
    private mainEl: HTMLElement | null = null;
    private sidebarEl: HTMLElement | null = null;
    private backdropEl: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(initialOpen: boolean, private config: SidebarManagerConfig) {
        this._isOpen = initialOpen;
    }

    get isOpen(): boolean {
        return this._isOpen;
    }

    // ----- Lifecycle -----

    /**
     * Call once in onOpen(). Sets up ResizeObserver and Escape key handler.
     * `registerDomEvent` should be the view's own registerDomEvent so that
     * Obsidian automatically cleans up listeners on view close.
     */
    attach(
        container: HTMLElement,
        registerDomEvent: (el: HTMLElement | Window | Document, event: string, handler: (e: any) => void) => void,
    ): void {
        this.containerEl = container;

        this.resizeObserver = new ResizeObserver(() => {
            this.setOpen(this._isOpen, 'resize', {
                persist: false,
                animate: false,
            });
        });
        this.resizeObserver.observe(container);

        const win = container.win ?? window;
        registerDomEvent(win, 'keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape' && this._isOpen) {
                event.preventDefault();
                this.setOpen(false, 'escape', { persist: true });
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
        const layout = parent.createDiv('view-sidebar-layout');
        this.layoutEl = layout;

        const main = layout.createDiv('view-sidebar-main');
        this.mainEl = main;

        const backdrop = layout.createDiv('view-sidebar-backdrop');
        backdrop.addEventListener('click', () => {
            if (this._isOpen) {
                this.setOpen(false, 'backdrop', { persist: true });
            }
        });
        this.backdropEl = backdrop;

        const sidebar = layout.createDiv('view-sidebar-panel');
        this.sidebarEl = sidebar;

        const sidebarHeader = sidebar.createDiv('view-sidebar__header');
        const sidebarBody = sidebar.createDiv('view-sidebar__body');

        // Apply current open/closed state to freshly created elements
        this.syncPresentation({ animate: false });

        return { main, sidebarHeader, sidebarBody };
    }

    // ----- State Control -----

    /**
     * Open or close the sidebar.
     * Mirrors the original TimelineView.setSidebarOpen() logic.
     */
    setOpen(
        nextOpen: boolean,
        source: SidebarToggleSource,
        options: Partial<{ persist: boolean; animate: boolean }> = {},
    ): void {
        const persist = options.persist ?? false;
        const animate = options.animate ?? this.shouldAnimate(source);
        const hasChanged = this._isOpen !== nextOpen;
        this._isOpen = nextOpen;
        this.syncPresentation({ animate });
        if (persist && hasChanged) {
            this.config.onPersist();
        }
    }

    /**
     * Synchronize CSS classes to match current state.
     * Call at the top of render() (before buildLayout) to handle the case
     * where container already has stale classes from a previous render.
     */
    syncPresentation(options: { animate: boolean }): void {
        this.applyResponsiveLayout();

        if (this.layoutEl) {
            this.layoutEl.classList.toggle('view-sidebar-layout--animate', options.animate);
        }
        if (this.sidebarEl) {
            this.sidebarEl.classList.toggle('view-sidebar-panel--hidden', !this._isOpen);
        }
        if (this.mainEl) {
            this.mainEl.classList.toggle('view-sidebar-main--open', this._isOpen);
        }
        if (this.backdropEl) {
            this.backdropEl.classList.toggle('view-sidebar-backdrop--visible', this._isOpen);
        }
        this.config.onSyncToggleButton?.();
    }

    // ----- Private Helpers -----

    private shouldAnimate(source: SidebarToggleSource): boolean {
        return source === 'toolbar' || source === 'backdrop' || source === 'escape';
    }

    private applyResponsiveLayout(): void {
        if (!this.containerEl) return;
        const width = this.containerEl.clientWidth;
        if (width <= 0) return; // Hidden tabs can report 0

        const isNarrow = width <= this.config.mobileBreakpointPx;
        this.layoutEl?.classList.toggle('view-sidebar-layout--mobile', isNarrow);
    }
}
