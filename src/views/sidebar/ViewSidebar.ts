/**
 * The right-side sidebar of Timeline and Calendar: its layout, whether it is
 * open, and the panel of frames it holds (`SidebarFrames`).
 *
 * The layout is built once, when the view opens (`build`): the view's main
 * area (`tv-sidebar__main`), the backdrop, and the panel with its body, in
 * which the frames are made. The view draws into the main area alone, and
 * empties only that, so the panel and what it holds stand in the document
 * for the view's life. A view opened in no document is put into one later;
 * the sidebar tells the panel then, so markdown that waited for a document
 * is rendered.
 *
 * The open state is the view's `showSidebar`, but at narrow width the
 * sidebar starts closed whatever the state says, and only the toggle button
 * opens it: `showSidebar` states the desktop-width position, and applying a
 * config never marks the sidebar as opened by the user. Its look (the
 * classes of the layout) follows the open state, applied when the user opens
 * or closes it, when the view's width changes, and when `showSidebar`
 * changes otherwise (a state handed in by the workspace or a URI). The
 * toggle, a click on the backdrop and the back close it. It takes no key:
 * Escape is left to the rest of the app.
 *
 * While the sidebar lies open over the view (narrow width), the view behind
 * the backdrop cannot be used, so the user's "back" (Android's back gesture,
 * the desktop mouse's back button: `HistoryBack`) closes it as a backdrop
 * click does. Beside the view (wide width) it leaves the back alone. The
 * back is held while both are so, from the look each sync applies, and let
 * go once either is not, or on `close`. A hidden tab reports no width and so
 * is not narrow: it does not take the back from the tab shown.
 */

import { holdHistoryBack } from '../sharedUI/HistoryBack';
import { SidebarFrames, type SidebarFramesDeps, type SidebarFramesState } from './SidebarFrames';

/** The fields of a view's state the sidebar reads and writes: whether it is open, and the panel's. */
export interface ViewSidebarState extends SidebarFramesState {
    showSidebar?: boolean;
}

/** What the sidebar is handed of its view. */
export interface ViewSidebarHost {
    state(): Readonly<ViewSidebarState>;
    subscribe(listener: (patch: Readonly<Partial<ViewSidebarState>>) => void): () => void;
    /** Change the view's state without drawing the view: the sidebar shows the change itself. */
    write(patch: Partial<ViewSidebarState>): void;
}

export interface ViewSidebarOptions {
    mobileBreakpointPx: number;
    /** Show on the view's toolbar whether the sidebar is open. */
    syncToggleButton: () => void;
}

export class ViewSidebar {
    private containerEl: HTMLElement | null = null;
    private layoutEl: HTMLElement | null = null;
    private mainEl: HTMLElement | null = null;
    private panelEl: HTMLElement | null = null;
    private backdropEl: HTMLElement | null = null;
    /** The panel of frames, made in the panel's body by `build`. */
    private frames: SidebarFrames | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private unsubscribe: (() => void) | null = null;
    /** Lets go of the back, while the sidebar lies open over the view. */
    private releaseBack: (() => void) | null = null;
    /** The user opened the sidebar with the toggle in this session: it opens at narrow width too. */
    private openedThisSession = false;
    /** Whether the container stood in a document when last seen: by `build`, then by each resize. */
    private inDocument = false;
    /** The sidebar writes `showSidebar` itself and shows it sliding; the change it hears back is not synced again. */
    private writingOpen = false;

    constructor(
        private readonly deps: SidebarFramesDeps,
        private readonly host: ViewSidebarHost,
        private readonly options: ViewSidebarOptions,
    ) {}

    // ----- Lifecycle -----

    /**
     * Build the layout in `container`, once, as the view opens, and give back
     * the main area, the one element the view draws into. The panel's frames
     * are made in the panel's body and start drawing. The sidebar starts
     * following the view's width and `showSidebar`.
     */
    build(container: HTMLElement): HTMLElement {
        this.containerEl = container;

        const layout = container.createDiv({ cls: 'tv-sidebar' });
        this.layoutEl = layout;
        const main = layout.createDiv({ cls: 'tv-sidebar__main' });
        this.mainEl = main;
        const backdrop = layout.createDiv({ cls: 'tv-sidebar__backdrop' });
        backdrop.addEventListener('click', () => {
            if (this.isOpen()) this.setOpen(false);
        });
        this.backdropEl = backdrop;
        const panel = layout.createDiv({ cls: 'tv-sidebar__panel' });
        this.panelEl = panel;
        const body = panel.createDiv({ cls: 'tv-sidebar__panel-body' });

        this.frames = new SidebarFrames(this.deps, this.host, body);

        // A view may be opened in no document (a leaf made apart from the
        // workspace) and put into one later; the container then takes a
        // size, which is the change seen here.
        this.inDocument = container.isConnected;
        this.resizeObserver = new ResizeObserver(() => {
            this.sync(this.isOpen(), { animate: false });
            this.followDocument();
        });
        this.resizeObserver.observe(container);

        this.unsubscribe = this.host.subscribe((patch) => {
            if ('showSidebar' in patch && !this.writingOpen) this.sync(this.isOpen(), { animate: false });
        });

        this.sync(this.isOpen(), { animate: false });
        this.frames.open();
        return main;
    }

    /** The view closes: stop the panel's frames, the width's watching and `showSidebar`'s, and let go of the back. */
    close(): void {
        this.frames?.close();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.holdBack(false);
    }

    /** Settings were saved: the panel answers (`SidebarFrames.settingsSaved`). */
    settingsSaved(): void {
        this.frames?.settingsSaved();
    }

    /** The visual day changed: the panel answers (`SidebarFrames.dayRolled`). */
    dayRolled(): void {
        this.frames?.dayRolled();
    }

    // ----- Open state -----

    /** Whether the sidebar shows: closed at narrow width until the toggle opens it this session. */
    isOpen(): boolean {
        if (this.isNarrow() && !this.openedThisSession) return false;
        return this.host.state().showSidebar ?? true;
    }

    /** The toolbar's toggle: opening marks the sidebar as opened by the user, so it opens at narrow width too. */
    toggle(open: boolean): void {
        if (open) this.openedThisSession = true;
        this.setOpen(open);
    }

    /** Whether the container is at or below the mobile breakpoint. A hidden tab, which has no width, is not. */
    isNarrow(): boolean {
        if (!this.containerEl) return false;
        const width = this.containerEl.clientWidth;
        if (width <= 0) return false;
        return width <= this.options.mobileBreakpointPx;
    }

    /** Open or close the sidebar, sliding; the view is not drawn. */
    private setOpen(open: boolean): void {
        this.writingOpen = true;
        try {
            this.host.write({ showSidebar: open });
        } finally {
            this.writingOpen = false;
        }
        this.sync(open, { animate: true });
    }

    /**
     * Tell the panel when the container has come into a document since it
     * was last seen, after the look is applied at the width it has there:
     * markdown that waited for a document is rendered then, not at the next
     * draw. A change of the width alone tells it nothing.
     */
    private followDocument(): void {
        const connected = this.containerEl?.isConnected ?? false;
        const entered = connected && !this.inDocument;
        this.inDocument = connected;
        if (entered) this.frames?.placed();
    }

    // ----- The look -----

    /** Apply `isOpen` to the layout's classes, hold or let go of the back, and show it on the toolbar. */
    private sync(isOpen: boolean, options: { animate: boolean }): void {
        this.applyResponsiveLayout();

        this.layoutEl?.classList.toggle('tv-sidebar--animate', options.animate);
        this.panelEl?.classList.toggle('tv-sidebar__panel--hidden', !isOpen);
        this.mainEl?.classList.toggle('tv-sidebar__main--open', isOpen);
        this.backdropEl?.classList.toggle('tv-sidebar__backdrop--visible', isOpen);
        this.holdBack(isOpen && this.isNarrow());
        this.options.syncToggleButton();
    }

    /** Hold the back while `held`, else let go of it; holding it twice holds it once. */
    private holdBack(held: boolean): void {
        if (held && !this.releaseBack) {
            this.releaseBack = holdHistoryBack(() => {
                if (this.isOpen()) this.setOpen(false);
            });
        } else if (!held && this.releaseBack) {
            this.releaseBack();
            this.releaseBack = null;
        }
    }

    private applyResponsiveLayout(): void {
        if (!this.containerEl) return;
        const width = this.containerEl.clientWidth;
        if (width <= 0) return; // Hidden tabs can report 0

        const isNarrow = width <= this.options.mobileBreakpointPx;
        this.layoutEl?.classList.toggle('tv-sidebar--mobile', isNarrow);
    }
}
