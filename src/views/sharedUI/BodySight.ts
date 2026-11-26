/**
 * Scroll `body` so that `el`, in it, is in its sight: no further than to show
 * it whole, or, when it is taller than the body shows, until its top is at
 * the body's top. Left as it is when `el` is in sight already.
 *
 * Done before a focus that does not scroll (`preventScroll`, an editor's
 * own focus): an on-screen keyboard rising for the focus then moves the
 * body from where it stands (`KeyboardRoom`).
 */
export function bringIntoView(body: HTMLElement, el: Element): void {
    const top = body.getBoundingClientRect().top + body.clientTop;
    const room = body.clientHeight;
    const box = el.getBoundingClientRect();
    const above = box.top - top;
    const below = box.bottom - top - room;
    const by = above < 0 || box.bottom - box.top > room ? above : below > 0 ? below : 0;
    if (by === 0) return;
    // At once, whatever scroll-behavior the stylesheet gives the body.
    body.scrollTo({ top: body.scrollTop + by, behavior: 'instant' });
}
