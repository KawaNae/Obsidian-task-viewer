import { TRANSIENT_DRAG_CLASSES } from '../../interaction/drag/constants';

/**
 * Keyed reconciler for `.task-card` elements across a render pass.
 *
 * Pattern (1 instance per render call):
 *   1. `detach(scope)` — index every existing card in `scope` by its
 *      `data-card-instance-id` and remove it from the DOM tree. The element
 *      itself stays alive (with its TaskCardRenderer cardComponents WeakMap
 *      entry, bound listeners, and inner markdown DOM intact).
 *   2. The view rebuilds its scaffolding (week rows / day columns / sections)
 *      and, for each intended card, calls `acquire(key)` to get back the
 *      existing element if one survived. Otherwise the view creates a fresh
 *      element. Either way the element is `appendChild`-ed into the new
 *      parent and re-decorated.
 *   3. `forEachStale(fn)` is called at the end so the caller can
 *      `taskRenderer.dispose(card)` any element that no longer corresponds to
 *      an intended card (filter dropped, segment vanished, etc.).
 *
 * Keys come from `dataset.cardInstanceId` which `TaskCardRenderer.render()`
 * stamps. Each view already builds these with enough scope (`viewId :: scope
 * :: id-or-segmentId`) to be unique within its container, which is exactly the
 * granularity reconciliation needs.
 */
export class CardReconciler {
    private survivors = new Map<string, HTMLElement>();

    /**
     * Index existing cards in `scope` by their cardInstanceId and detach them
     * from the DOM. Cards without a `data-card-instance-id` (i.e. not yet
     * passed through `TaskCardRenderer.render`) are left alone — they belong
     * to scaffolding paths the reconciler does not own.
     */
    detach(scope: HTMLElement): void {
        scope.querySelectorAll<HTMLElement>('.task-card[data-card-instance-id]').forEach(card => {
            const key = card.dataset.cardInstanceId;
            if (!key) return;
            this.survivors.set(key, card);
            card.remove();
        });
    }

    /**
     * Return (and consume) the surviving card for `key`, or undefined if the
     * caller has to build a new one. Consuming guarantees the same key cannot
     * be acquired twice in a single reconcile pass.
     */
    acquire(key: string): HTMLElement | undefined {
        const el = this.survivors.get(key);
        if (el) {
            this.survivors.delete(key);
            // Render never owns transient drag state — the active gesture
            // re-applies it on the next onDown/onMove. Stripping it from reused
            // cards means a missed gesture-end (e.g. pointercancel) cannot leave
            // a card stuck invisible across re-renders.
            el.classList.remove(...TRANSIENT_DRAG_CLASSES);
        }
        return el;
    }

    /**
     * Walk every card that was detached but never re-acquired. The caller is
     * expected to dispose Component lifecycles and leave the element to GC
     * (the element is already detached from the DOM).
     */
    forEachStale(fn: (card: HTMLElement) => void): void {
        this.survivors.forEach(fn);
        this.survivors.clear();
    }

    /** Number of cards currently waiting to be acquired or marked stale. */
    get pendingCount(): number {
        return this.survivors.size;
    }
}
