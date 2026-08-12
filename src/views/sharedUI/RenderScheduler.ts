import { HostFrameScheduler } from '../../utils/HostWindow';

/**
 * Handlers a view supplies to the render scheduler.
 */
export interface RenderSchedulerHandlers {
    /** Re-render the whole view. The view internally reconciles card DOM. */
    performFull: () => void;
    /**
     * The view's container element (resolved lazily — views build it in
     * onOpen and can be moved between windows afterwards). The coalescing
     * frame is taken from **this element's own window**, so a popout view is
     * clocked by the popout: the main window's rAF stops while it is
     * minimized, and its frames carry no paint-order guarantee for another
     * window's compositor.
     */
    getHost: () => Node | null;
}

/**
 * View-shared render scheduler. Coalesces redraw requests through rAF so
 * bursts of `readService.onChange` events collapse into a single render.
 *
 * The renderer no longer makes a partial-vs-full decision: keyed
 * reconciliation inside `performFull` reuses surviving card elements by
 * `data-card-instance-id`, so a "full" render is cheap when most cards are
 * unchanged. `blockId` / `timerTargetId` flips have no visual effect at all
 * and are short-circuited here.
 *
 * Exposes:
 *   - `handleChange(taskId, changes)` — `readService.onChange` entry point.
 *   - `scheduleRender()` — request a render any time (filter change etc.).
 *   - `performImmediate()` — bypass the rAF, render synchronously now.
 *   - `cancelPending()` — drop a pending rAF without rendering.
 */
export class RenderScheduler {
    private rafId: number | null = null;
    private dirty = false;
    private readonly frames: HostFrameScheduler;

    constructor(private handlers: RenderSchedulerHandlers) {
        this.frames = new HostFrameScheduler(handlers.getHost);
    }

    /**
     * `readService.onChange` entry point. Skips the render entirely if every
     * key in `changes` is purely internal (`blockId`, `timerTargetId`); those
     * flips do not affect any rendered card.
     */
    handleChange(taskId: string | undefined, changes: string[] | undefined): void {
        if (!shouldRenderForChanges(changes)) {
            return;
        }
        this.scheduleRender();
    }

    /** Request a render. rAF-coalesced on the host window's frame clock. */
    scheduleRender(): void {
        this.dirty = true;
        if (this.rafId !== null) return;
        this.rafId = this.frames.request(() => {
            this.rafId = null;
            if (!this.dirty) return;
            this.dirty = false;
            this.handlers.performFull();
        });
    }

    /** Cancel any pending rAF, then render synchronously. */
    performImmediate(): void {
        if (this.rafId !== null) {
            this.frames.cancel(this.rafId);
            this.rafId = null;
        }
        this.dirty = false;
        this.handlers.performFull();
    }

    /** Drop a pending rAF without rendering (used right before a sync render). */
    cancelPending(): void {
        if (this.rafId !== null) {
            this.frames.cancel(this.rafId);
            this.rafId = null;
            this.dirty = false;
        }
    }

    /** Tear down on view unload. */
    dispose(): void {
        this.frames.dispose();
        this.rafId = null;
        this.dirty = false;
    }
}

/** Keys with zero visual effect — render is skipped entirely. */
const NO_RENDER_KEYS = new Set(['blockId', 'timerTargetId']);

/**
 * Whether a `readService.onChange` notification warrants a re-render. A change
 * touching only internal keys (blockId / timerTargetId) has zero visual effect
 * and is skipped. Single authority shared by every card-bearing view — both the
 * scheduler-backed views and the renderers that lack a scheduler (e.g.
 * PinnedListRenderer).
 */
export function shouldRenderForChanges(changes?: string[]): boolean {
    return !(changes && changes.length > 0 && changes.every(c => NO_RENDER_KEYS.has(c)));
}
