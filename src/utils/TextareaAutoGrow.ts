/**
 * Grows a textarea (or any block element with a `style`/`scrollHeight`) to
 * fit its content, so a multi-line value never needs its own internal
 * scrollbar.
 *
 * `field-sizing: content` would do this in CSS alone, but iOS WKWebView
 * doesn't support it yet, so callers still need this after every value
 * change: on bind, on input, and after `syncFromFile` rewrites the value.
 * Resetting height to `auto` first is required — otherwise `scrollHeight`
 * reports the old (possibly larger) box instead of the content's natural
 * height, and the element never shrinks back down.
 *
 * Two caller-side traps this guards against:
 *  - Calling this mid-construction, before the element's siblings have been
 *    appended, bakes in a `scrollHeight` measured against an unsettled
 *    layout (observed: 200 chars measuring 152px pre-render, 114px once the
 *    render actually finished). Callers must call this only after the DOM
 *    they're building is fully assembled, not per-item while building it.
 *  - A `display:none` ancestor (widget container hidden, popout mid-toggle)
 *    collapses `scrollHeight` to 0 regardless of content. Baking that in as
 *    `height:0px` sticks even after the ancestor becomes visible again,
 *    since nothing re-measures on the visibility change itself. The guard
 *    below leaves the inline height untouched while hidden; the next call
 *    that lands while visible (render / input / syncFromFile) fixes it up.
 */
export function autoGrowTextarea(el: HTMLElement): void {
    if (el.scrollHeight === 0) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
}
