/**
 * Serializes an async render so its detach -> await(markdown) -> dispose cycle
 * stays atomic against re-entry. Views whose performRender awaits markdown
 * rendering (Calendar, Schedule) must funnel EVERY render entry point
 * (render / setState / onOpen) through a single instance, otherwise two passes
 * can interleave on the same CardReconciler-managed container and duplicate or
 * orphan cards.
 *
 * Complements RenderScheduler: the scheduler decides *when* to render (rAF
 * coalescing of change events); this decides that renders run *one at a time*.
 * A request that arrives mid-flight is coalesced into a single trailing pass so
 * the final state always reflects the latest data.
 */
export class AsyncRenderSerializer {
    private isRendering = false;
    private renderPending = false;

    constructor(private readonly run: () => Promise<void>) {}

    /**
     * Run the render. If one is already in flight, mark a trailing pass and
     * return immediately (it will be picked up by the in-flight loop). Resolves
     * once the render cycle has settled.
     */
    async request(): Promise<void> {
        if (this.isRendering) {
            this.renderPending = true;
            return;
        }
        this.isRendering = true;
        try {
            do {
                this.renderPending = false;
                await this.run();
            } while (this.renderPending);
        } finally {
            this.isRendering = false;
        }
    }
}
