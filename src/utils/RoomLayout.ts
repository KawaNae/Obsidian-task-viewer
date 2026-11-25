/**
 * What `KeyboardRoom` reads and writes of an overlay: the overlap of the
 * on-screen keyboard given to its root, where its body and the field typed
 * at stand, the body's scrollTop, and the height and the padding written on
 * the body. Nothing here decides; the room asks.
 */

/** The CSS variable on the overlay's root: how much of the window the keyboard covers (px). */
export const KEYBOARD_OVERLAP_VAR = '--tv-keyboard-overlap';

/** Where the body and what is typed at stand, under one overlap. */
export interface Place {
    /** The overlap laid out (px). */
    readonly overlap: number;
    /** The keyboard's top as that overlap lays it out: the window's bottom less the overlap (client px). */
    readonly edge: number;
    /** Where what is typed at ends (an input's bottom, an editor's caret; client px), null with nothing. */
    readonly field: number | null;
    readonly bodyTop: number;
    readonly bodyBottom: number;
    /** The body's visible height (its border box, as it would be locked). */
    readonly bodyHeight: number;
    /** The body's scrollTop as read with the rest. */
    readonly scrollTop: number;
    /** How far the body can scroll (scrollHeight less clientHeight). */
    readonly scrollRange: number;
}

export class RoomLayout {
    /** The body's inline height, max-height and padding before they were written, while they are. */
    private saved: { height: string; maxHeight: string; paddingBottom: string } | null = null;
    /** The body's padding-bottom from the stylesheet as it was locked (px). */
    private basePad = 0;
    /** The overlap last written on the root (px), 0 while none is. */
    private written = 0;

    constructor(
        private readonly root: HTMLElement,
        private readonly win: Window,
        private readonly body: HTMLElement,
    ) {}

    /** The overlap last written on the root (px). */
    writtenOverlap(): number {
        return this.written;
    }

    /** Give the root an overlap: none at 0. The stylesheet moves what it lays out over its transition. */
    writeOverlap(px: number): void {
        this.written = px;
        this.put(px);
    }

    private put(px: number): void {
        const style = this.root.style;
        if (px > 0) style.setProperty(KEYBOARD_OVERLAP_VAR, `${px}px`);
        else style.removeProperty(KEYBOARD_OVERLAP_VAR);
    }

    /**
     * The overlap the root lays out now (px): midway through its transition
     * while that runs. What was written where the computed style cannot be
     * read.
     */
    shownOverlap(): number {
        const style = this.win.getComputedStyle?.(this.root);
        const raw = typeof style?.getPropertyValue === 'function'
            ? style.getPropertyValue(KEYBOARD_OVERLAP_VAR).trim()
            : '';
        if (raw === '') return this.written;
        const px = parseFloat(raw);
        return Number.isFinite(px) ? px : this.written;
    }

    /**
     * Where things stand now. The keyboard's top is read where the overlap
     * shown lays it out, unless `overlap` is given: a panel placed by script
     * stands over the keyboard's own top, whatever the root shows.
     */
    read(field: HTMLElement | null, overlap = this.shownOverlap()): Place {
        return this.measure(field, overlap);
    }

    /**
     * Where things will stand once the overlap has come to `overlap`, then
     * the root given `overlap`, moving there from what it shows now.
     *
     * The root's transition is held off while `overlap` is laid out and
     * read, and the overlap shown is given back before it is let run again:
     * a transition is started only by a change of the value with it on, so
     * the root left at `overlap` would show it at once. Holding it off
     * cancels a transition under way; the one started after runs again from
     * where that one stood, over the whole of its length.
     */
    readAt(overlap: number, field: HTMLElement | null): Place {
        const shown = this.shownOverlap();
        const scrollTop = this.body.scrollTop;
        const style = this.root.style;
        const transition = style.transition;
        style.transition = 'none';
        try {
            this.put(overlap);
            return this.measure(field, overlap);
        } finally {
            // Given back however the read ends, a throw among it, so the
            // root is not left at `overlap` with its transition held off.
            this.put(shown);
            this.win.getComputedStyle?.(this.root)?.getPropertyValue?.(KEYBOARD_OVERLAP_VAR);
            style.transition = transition;
            this.writeOverlap(overlap);
            // A body laid out shorter for the read may have had its scroll cut.
            if (this.body.scrollTop !== scrollTop) this.scrollTop = scrollTop;
        }
    }

    private measure(field: HTMLElement | null, overlap: number): Place {
        const body = this.body;
        const rect = body.getBoundingClientRect();
        const scrollTop = body.scrollTop;
        return {
            overlap,
            edge: this.win.innerHeight - overlap,
            field: field ? typedAt(field) : null,
            bodyTop: rect.top,
            bodyBottom: rect.bottom,
            bodyHeight: rect.height,
            scrollTop,
            scrollRange: this.range(),
        };
    }

    /** How far the body scrolls as it is laid out now: its scrollHeight less its clientHeight. */
    private range(): number {
        return Math.max(0, (this.body.scrollHeight - this.body.clientHeight) || 0);
    }

    /**
     * The padding the body needs to scroll to `top`, at least `least` px
     * past the stylesheet's, with its height locked as it is, or at
     * `height` where it is not; and how far it then scrolls. The padding
     * is written and the range read after each write: a padding does not
     * lengthen the range by as much where the content gives way to it (a
     * part cut to the room left above the padding grows shorter by as much,
     * until it is cut to nothing more). The body's height, padding and
     * scrollTop are given back as they were.
     *
     * Each write adds what the range still lacks, or twice the last step
     * where that step lengthened it by nothing, the content having given way
     * to it all. What gives way stands in the body's room, so it gives at
     * most the body's height: the padding goes no further than what was
     * lacking at `least` and that height, past which no layout lengthens
     * the range by more, and where it still lacks then, the body is given
     * that padding and scrolls as far as it does.
     */
    padFor(top: number, least: number, height: number): { pad: number; range: number } {
        const locked = this.saved !== null;
        const written = this.body.style.paddingBottom;
        const scrollTop = this.body.scrollTop;
        if (!locked) this.lock(height);
        try {
            let pad = least;
            this.pad(pad);
            let range = this.range();
            const most = pad + Math.max(0, top - range) + this.body.clientHeight;
            let step = top - range;
            while (top - range >= 1 && pad < most) {
                const before = range;
                pad = Math.min(most, pad + step);
                this.pad(pad);
                range = this.range();
                step = range - before < 1 ? step * 2 : top - range;
            }
            return { pad, range };
        } finally {
            if (locked) this.body.style.paddingBottom = written;
            else this.release();
            if (this.body.scrollTop !== scrollTop) this.scrollTop = scrollTop;
        }
    }

    get scrollTop(): number {
        return this.body.scrollTop;
    }

    /** Scroll the body to `top` at once, whatever scroll-behavior the stylesheet gives it. */
    set scrollTop(top: number) {
        this.body.scrollTo({ top, behavior: 'instant' });
    }

    /** The document's and the root's scrollTop, for the log: what the browser may scroll instead of the body. */
    outerScroll(): { doc: number; root: number } {
        const doc = this.root.ownerDocument?.scrollingElement?.scrollTop ?? 0;
        return { doc, root: this.root.scrollTop ?? 0 };
    }

    /** Whether the body's height is locked. */
    locked(): boolean {
        return this.saved !== null;
    }

    /**
     * Lock the body's height at `height`, as a max-height too: a flex item
     * whose basis falls back to its content (`flex: 1` in a column of no set
     * height) takes no height and would grow by the padding, while a
     * max-height bounds it however it is laid out.
     */
    lock(height: number): void {
        if (this.saved) return;
        const s = this.body.style;
        this.saved = { height: s.height, maxHeight: s.maxHeight, paddingBottom: s.paddingBottom };
        this.basePad = parseFloat(this.win.getComputedStyle(this.body).paddingBottom) || 0;
        s.height = `${height}px`;
        s.maxHeight = `${height}px`;
    }

    /** Pad the locked body's bottom by `px` past the stylesheet's padding: none at 0. */
    pad(px: number): void {
        if (!this.saved) return;
        this.body.style.paddingBottom = px > 0 ? `${this.basePad + px}px` : this.saved.paddingBottom;
    }

    /** Put the body's height and padding back as they were before the lock. */
    release(): void {
        const saved = this.saved;
        if (!saved) return;
        const s = this.body.style;
        s.height = saved.height;
        s.maxHeight = saved.maxHeight;
        s.paddingBottom = saved.paddingBottom;
        this.saved = null;
    }
}

/** Where what is typed at in `field` ends: an editable element's caret, an input's or a textarea's bottom. */
function typedAt(field: HTMLElement): number {
    if (field.isContentEditable) return caretRect(field)?.bottom ?? field.getBoundingClientRect().bottom;
    return field.getBoundingClientRect().bottom;
}

/**
 * Where the caret of an editable field stands: the selection's focus, as
 * the DOM lays it out, when it is in `field`. A caret between elements (an
 * empty line) has no box of its own, and stands for the element it is in.
 */
function caretRect(field: HTMLElement): DOMRect | null {
    const doc = field.ownerDocument;
    const selection = doc.getSelection();
    const node = selection?.focusNode ?? null;
    if (!selection || !node || !field.contains(node)) return null;
    const range = doc.createRange();
    range.setStart(node, selection.focusOffset);
    range.collapse(true);
    const rects = range.getClientRects();
    const last = rects.length > 0 ? rects[rects.length - 1] : null;
    if (last && last.height > 0) return last;
    const el = node.nodeType === 1 ? node as Element : node.parentElement;
    return el ? el.getBoundingClientRect() : null;
}
