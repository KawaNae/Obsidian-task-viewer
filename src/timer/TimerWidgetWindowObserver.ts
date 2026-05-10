/**
 * Routes the floating timer widget between Obsidian's main and popout windows.
 *
 * Default state is "pinned to current host" — the widget never moves on its
 * own. The user clicks the pin badge to enter "pending" state; the next
 * `active-leaf-change` to a different host window migrates the widget there
 * and re-pins automatically. This avoids window ping-ponging while still
 * letting users move the widget without a drag-across-windows gesture.
 *
 * Container DOM is owned by FloatingOverlayHost and re-created per window
 * (DOM nodes belong to a specific document and can't be moved across
 * documents). Timer state lives in TimerWidget (plugin scope) and is
 * unaffected by migration.
 *
 * Mirrors PropertySuggestObserver's facade pattern: a single observer
 * subscribes to workspace events and manages per-window resources.
 */

import { App, WorkspaceLeaf, WorkspaceWindow } from 'obsidian';
import TaskViewerPlugin from '../main';
import { FloatingOverlayHost } from './FloatingOverlayHost';
import { TimerWidget } from './TimerWidget';

const NON_DRAGGABLE_SELECTORS = [
    '.timer-widget__pin-badge',
    '.timer-widget__item button',
    '.timer-widget__item input',
];

export type PinState = 'pinned' | 'pending';

export class TimerWidgetWindowObserver {
    private host: FloatingOverlayHost;
    private currentWin: Window | null = null;
    private pinned = true;
    private pendingMigration: { win: Window; doc: Document } | null = null;

    constructor(
        private app: App,
        private plugin: TaskViewerPlugin,
        private widget: TimerWidget,
    ) {
        this.host = new FloatingOverlayHost({
            nonDraggableSelectors: NON_DRAGGABLE_SELECTORS,
        });
        this.host.setOnDragEnd(() => this.flushPendingMigration());
    }

    start(): void {
        this.plugin.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => this.handleActiveLeafChange(leaf)),
        );
        this.plugin.registerEvent(
            this.app.workspace.on('window-open', () => {
                // floatingSplit.children is updated synchronously *after* this
                // handler returns, so defer the render to the next microtask
                // when the count reflects the newly-opened popout.
                Promise.resolve().then(() => this.widget.render());
            }),
        );
        this.plugin.registerEvent(
            this.app.workspace.on('window-close', (ww: WorkspaceWindow) => {
                this.handleWindowClose(ww);
                // Same deferral so the count reflects the closed popout.
                Promise.resolve().then(() => this.widget.render());
            }),
        );
    }

    /**
     * Lazily create the container in the currently active window. Called by
     * TimerWidget the first time a render is requested (i.e. a timer starts
     * or restored timers are re-shown).
     */
    ensureContainer(): HTMLElement {
        const existing = this.host.getContainer();
        if (existing) return existing;

        const { win, doc } = this.resolveActiveHost();
        this.currentWin = win;
        return this.host.attach(win, doc, 'timer-widget');
    }

    destroyContainer(): void {
        this.host.detach();
        this.currentWin = null;
        this.pendingMigration = null;
    }

    hasContainer(): boolean {
        return this.host.getContainer() !== null;
    }

    getPinState(): PinState {
        return this.pinned ? 'pinned' : 'pending';
    }

    /**
     * Toggle pinned/pending. From pinned → pending (waiting for next active
     * leaf in another window). From pending → pinned (cancel the move; widget
     * stays where it is).
     */
    togglePin(): void {
        this.pinned = !this.pinned;
        this.widget.render();
    }

    /**
     * Pin badge is only meaningful when more than one window exists. On
     * mobile the popout API is absent (`floatingSplit` empty), so the badge
     * stays hidden. On desktop it appears the moment the user opens a popout
     * and disappears when the last popout closes.
     */
    shouldShowPinBadge(): boolean {
        // floatingSplit is the undocumented popout container; cast since it
        // isn't part of the public Workspace type. Mobile builds don't have
        // it, so the count is 0 and the badge stays hidden.
        const fs = (this.app.workspace as unknown as { floatingSplit?: { children?: unknown[] } }).floatingSplit;
        const popoutCount = fs?.children?.length ?? 0;
        return popoutCount > 0;
    }

    private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
        if (!leaf) return;
        if (this.pinned) return;
        if (!this.host.getContainer()) return;

        const container = leaf.getContainer();
        const newWin = container?.win ?? null;
        const newDoc = container?.doc ?? null;
        if (!newWin || !newDoc || newWin === this.currentWin) return;

        if (this.host.isDragInProgress()) {
            this.pendingMigration = { win: newWin, doc: newDoc };
            return;
        }
        this.migrate(newWin, newDoc);
    }

    private handleWindowClose(ww: WorkspaceWindow): void {
        if (ww.win !== this.currentWin) return;
        // Forced migration to main window. Always re-pin so a half-completed
        // unpin gesture doesn't immediately bounce the widget back to a
        // popout via a trailing active-leaf-change.
        this.migrate(window, document);
    }

    private migrate(win: Window, doc: Document): void {
        this.host.detach();
        this.currentWin = win;
        this.host.attach(win, doc, 'timer-widget');
        this.pinned = true;
        this.widget.render();
    }

    private flushPendingMigration(): void {
        const next = this.pendingMigration;
        this.pendingMigration = null;
        if (!next) return;
        if (next.win === this.currentWin) return;
        this.migrate(next.win, next.doc);
    }

    private resolveActiveHost(): { win: Window; doc: Document } {
        const activeLeaf = this.app.workspace.activeLeaf;
        const container = activeLeaf?.getContainer();
        const win = container?.win ?? window;
        const doc = container?.doc ?? document;
        return { win, doc };
    }
}
