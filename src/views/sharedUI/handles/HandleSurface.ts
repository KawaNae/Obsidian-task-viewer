/**
 * Which set of drag handles a task card gets.
 *
 * A card laid out on a day grid (calendar week rows, the all-day lane) resizes
 * left and right and moves from its bottom corners. A card on the timeline's
 * time axis resizes top and bottom. Which one applies is a property of the
 * surface the card was rendered onto, so the renderer that creates the card
 * states it via `data-handle-surface` and HandleManager just reads it back.
 *
 * Before this, HandleManager sniffed for `.cal-week-row` — a calendar-specific
 * selector living in shared code, which is exactly the coupling that kept the
 * handle code filed under `timelineview/` while Calendar imported across.
 */
export type HandleSurface = 'grid' | 'timeline';

const ATTR = 'handleSurface';

/** Stamp the surface on a card as it is rendered. Idempotent. */
export function markHandleSurface(taskEl: HTMLElement, surface: HandleSurface): void {
    taskEl.dataset[ATTR] = surface;
}

/**
 * Read the surface back. Cards that were never stamped fall back to
 * `'timeline'`, which is what an unmarked card would have resolved to before.
 */
export function resolveHandleSurface(taskEl: HTMLElement): HandleSurface {
    return taskEl.dataset[ATTR] === 'grid' ? 'grid' : 'timeline';
}
