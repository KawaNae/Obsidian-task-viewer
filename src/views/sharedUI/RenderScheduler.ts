/**
 * Handlers a view supplies to the render scheduler.
 */
export interface RenderSchedulerHandlers {
    /** Re-render the whole view. The view internally reconciles card DOM. */
    performFull: () => void;
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

    constructor(private handlers: RenderSchedulerHandlers) {}

    /**
     * `readService.onChange` entry point. Skips the render entirely if every
     * key in `changes` is purely internal (`blockId`, `timerTargetId`); those
     * flips do not affect any rendered card.
     */
    handleChange(taskId: string | undefined, changes: string[] | undefined): void {
        if (changes && changes.length > 0 && changes.every(c => NO_RENDER_KEYS.has(c))) {
            return;
        }
        this.scheduleRender();
    }

    /** Request a render. rAF-coalesced. */
    scheduleRender(): void {
        this.dirty = true;
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            if (!this.dirty) return;
            this.dirty = false;
            this.handlers.performFull();
        });
    }

    /** Cancel any pending rAF, then render synchronously. */
    performImmediate(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.dirty = false;
        this.handlers.performFull();
    }

    /** Drop a pending rAF without rendering (used right before a sync render). */
    cancelPending(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
            this.dirty = false;
        }
    }

    /** Tear down on view unload. */
    dispose(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.dirty = false;
    }
}

/** Keys with zero visual effect — render is skipped entirely. */
const NO_RENDER_KEYS = new Set(['blockId', 'timerTargetId']);
