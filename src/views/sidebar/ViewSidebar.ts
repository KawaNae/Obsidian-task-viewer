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
 * Whether it is open is held twice, one for each width. Beside the view
 * (wide width) it is the view's `showSidebar`, which is saved with the view,
 * copied into its URI and templates, and written by the toggle alone. Over
 * the view (narrow width) it is a value of the sidebar's own, never saved:
 * it is closed whenever the view is seen not narrow (wide, or a hidden tab,
 * which has no width), so each time the view is shown narrow the sidebar
 * starts closed, and the toggle, a click on the backdrop and the back open
 * and close it there without touching `showSidebar`. A narrow sidebar
 * closed on a phone thus leaves the view's saved position as it was.
 *
 * Its look (the classes of the layout) follows the open state, applied when
 * the user opens or closes it (sliding), when the view's width changes, and
 * when `showSidebar` changes otherwise (a state handed in by the workspace or
 * a URI), which shows only at wide width. It takes no key: Escape is left to
 * the rest of the app.
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
    /** Whether the sidebar is open over the view, at narrow width; closed whenever the view is seen not narrow. */
    private openNarrow = false;
    /** Whether the look last applied shows the sidebar open; none before the first. */
    private shown: boolean | null = null;
    /** Whether the container stood in a document when last seen: by `build`, then by each resize. */
    private inDocument = false;

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
        backdrop.addEventListener('click', () => this.closeOver());
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
            if (!this.isNarrow()) this.openNarrow = false;
            this.sync(this.isOpen(), { animate: false });
            this.followDocument();
        });
        this.resizeObserver.observe(container);

        // The toggle applies its own change, sliding, before it writes it:
        // hearing it back, the look already is what it says.
        this.unsubscribe = this.host.subscribe((patch) => {
            if ('showSidebar' in patch && this.isOpen() !== this.shown) this.sync(this.isOpen(), { animate: false });
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

    /** Whether the sidebar shows: over the view, its own value; beside it, `showSidebar`. */
    isOpen(): boolean {
        if (this.isNarrow()) return this.openNarrow;
        return this.host.state().showSidebar ?? true;
    }

    /**
     * The toolbar's toggle, sliding; the view is not drawn. Over the view it
     * opens or closes the sidebar there alone; beside it, it writes
     * `showSidebar`.
     */
    toggle(open: boolean): void {
        if (this.isNarrow()) {
            this.openNarrow = open;
            this.sync(open, { animate: true });
            return;
        }
        this.sync(open, { animate: true });
        this.host.write({ showSidebar: open });
    }

    /** Whether the container is at or below the mobile breakpoint. A hidden tab, which has no width, is not. */
    isNarrow(): boolean {
        if (!this.containerEl) return false;
        const width = this.containerEl.clientWidth;
        if (width <= 0) return false;
        return width <= this.options.mobileBreakpointPx;
    }

    /** The backdrop and the back: close the sidebar lying open over the view, sliding; `showSidebar` is left alone. */
    private closeOver(): void {
        if (!this.isNarrow() || !this.openNarrow) return;
        this.openNarrow = false;
        this.sync(false, { animate: true });
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
        this.shown = isOpen;
        this.holdBack(isOpen && this.isNarrow());
        this.options.syncToggleButton();
    }

    /** Hold the back while `held`, else let go of it; holding it twice holds it once. */
    private holdBack(held: boolean): void {
        if (held && !this.releaseBack) {
            this.releaseBack = holdHistoryBack(() => this.closeOver());
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
