/**
 * Handlers a view supplies to the render controller.
 *
 * Note: classification (`tryPartial` / `refreshPinned`) was retired in favour
 * of keyed reconciliation inside `performFull` itself. The controller is now
 * a small rAF coalescer; the view re-uses card elements per render via
 * `CardReconciler`. A dedicated rename to `RenderScheduler` is tracked for a
 * later cleanup pass — keeping `RenderController` here for now to limit the
 * blast radius of this change.
 */
export interface RenderControllerHandlers {
    /** Re-render the whole view. The view internally reconciles card DOM. */
    performFull: () => void;
}

/**
 * View-shared render dispatcher. Exposes:
 *   - `handleChange(taskId, changes)` — on data change, schedule a render.
 *     `blockId` / `timerTargetId` flips have no visual effect and are skipped.
 *   - `scheduleRender()` — request a render any time (filter change etc.),
 *     coalesced via rAF.
 *   - `performImmediate()` — bypass the rAF, render synchronously now.
 *   - `cancelPending()` — drop a pending rAF without rendering.
 */
export class RenderController {
    private rafId: number | null = null;
    private dirty = false;

    constructor(private handlers: RenderControllerHandlers) {}

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

    /** Request a full render. rAF-coalesced. */
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
