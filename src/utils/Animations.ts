/**
 * Waiting out what moves: an element and what is in it read where they come
 * to rest, not midway through an animation (an overlay's panel sliding or
 * popping in).
 */

/**
 * The animations running in `el` and what is in it that will end (an
 * endless one, a spinner, would never be waited out). None where the DOM
 * cannot list them (`getAnimations`).
 */
export function runningAnimations(el: Element): Animation[] {
    if (typeof el.getAnimations !== 'function') return [];
    return el.getAnimations({ subtree: true }).filter((a) =>
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
