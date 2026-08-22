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
 */
export function autoGrowTextarea(el: HTMLElement): void {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
}
