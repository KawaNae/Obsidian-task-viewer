/**
 * Waiting out what moves: an element read where it comes to rest, not
 * midway through an animation of its own (an overlay's panel sliding or
 * popping in).
 */

/**
 * The animations running on `el` that will end (an endless one, a spinner,
 * would never be waited out): its own, not those of what is in it. None
 * where the DOM cannot list them (`getAnimations`).
 */
export function runningAnimations(el: Element): Animation[] {
    if (typeof el.getAnimations !== 'function') return [];
    return el.getAnimations({ subtree: false }).filter((a) =>
        a.playState === 'running'
        && Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? Infinity)));
}

/**
 * Resolves once each of `animations` has stopped moving: ended, or
 * cancelled (an animation taken off, as the sheet dragged by its handle
 * does), which rejects its `finished` all the same.
 */
export function whenStopped(animations: readonly Animation[]): Promise<void> {
    return Promise.allSettled(animations.map((a) => a.finished)).then(() => undefined);
}
