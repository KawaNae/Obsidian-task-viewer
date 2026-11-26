/**
 * What `KeyboardRoom` reads and writes of an overlay: the overlap of the
 * on-screen keyboard given to its root, where its body and the field typed
 * at stand, the body's scrollTop, and the height and the padding written on
 * the body. Nothing here decides; the room asks.
 */

/**
 * The CSS variable on the overlay's root: how much of the window the
 * keyboard covers (px). The stylesheet moves it over a transition, and
 * lays the sheet out by it as it moves.
 */
export const KEYBOARD_OVERLAP_VAR = '--tv-keyboard-overlap';

/**
 * The CSS variable on the root: the overlap where its move ends (px), with
 * no transition. The stylesheet lays the centred box out by it, so the box
 * is laid out where it goes at once.
 */
export const KEYBOARD_OVERLAP_TO_VAR = '--tv-keyboard-overlap-to';

/**
 * The CSS variable on the root: how far the centred box is drawn from where
 * it is laid out (px, its translate). The stylesheet moves it over the same
 * transition as the overlap; it is 0 while nothing moves.
 */
export const BOX_SHIFT_VAR = '--tv-box-shift';

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
    /** The overlap the box is laid out by, last written on the root (px). */
    private writtenTo = 0;
    /** The shift the last write of the overlap moved the box from (px), 0 where it moved nothing. */
    private shiftedFrom = 0;

    /**
     * `panel` is the panel `body` stands in, as the box: what it moved by is
     * read from where it is laid out (its `offsetTop`, which neither its
     * translate nor its transform moves).
     */
    constructor(
        private readonly root: HTMLElement,
        private readonly win: Window,
        private readonly panel: HTMLElement,
        private readonly body: HTMLElement,
    ) {}

    /** The overlap last written on the root (px). */
    writtenOverlap(): number {
        return this.written;
    }

    /** The shift the last write of the overlap moved the box from (px): 0 where it moved nothing. */
    shiftWritten(): number {
        return this.shiftedFrom;
    }

    /**
     * Give the root an overlap: none at 0. The overlap moves to it over its
     * transition, and the sheet with it. The box is laid out where the
     * overlap ends at once, and drawn from where it was seen: its shift is
     * given what the box moved by, and moves to 0 over the same transition.
     * So the box moves from where it is seen, at rest or on its way, over
     * the whole of the transition, slowing to its stop. Where it rests is
     * the stylesheet's alone: the shift is 0 there.
     *
     * A root that shows the overlap at once has the box laid out there at
     * once too, with no shift: one not laid out yet (an overlay opened over
     * the keyboard), or a browser that cannot register the variables.
     */
    writeOverlap(px: number): void {
        this.written = px;
        this.shiftedFrom = 0;
        // Written before anything is read: a root not laid out yet is laid
        // out first with it, and shows it with no transition.
        this.put(px);
        const shown = this.shownOverlap();
        if (Math.abs(shown - px) < 0.5) {
            this.putTo(px);
            this.putShift(0);
            return;
        }
        const from = this.shownShift() + this.layBox(px);
        if (Math.abs(from) < 0.5) {
            this.putShift(0);
            return;
        }
        // The shift is put where the box was seen with the transition held
        // off, so it is shown there at once, and given 0 once the transition
        // runs again: it moves from there. The overlap is held where it is
        // shown meanwhile, the hold cancelling its transition, and given `px`
        // again with the shift, so the two move together.
        this.held(() => {
            this.put(shown);
            this.putShift(from);
        });
        this.put(px);
        this.putShift(0);
        this.shiftedFrom = from;
    }

    /** Lay the box out where the overlap `px` ends, and give how far that moved it (px: where it stood less where it stands). */
    private layBox(px: number): number {
        const before = this.panel.offsetTop;
        this.putTo(px);
        // A panel not laid out gives no number: nothing moved.
        return (before - this.panel.offsetTop) || 0;
    }

    private put(px: number): void {
        this.putVar(KEYBOARD_OVERLAP_VAR, px > 0 ? px : 0);
    }

    private putTo(px: number): void {
        this.writtenTo = px;
        this.putVar(KEYBOARD_OVERLAP_TO_VAR, px > 0 ? px : 0);
    }

    private putShift(px: number): void {
        this.putVar(BOX_SHIFT_VAR, px);
    }

    /** Write `name` on the root as `px`: none at 0, the stylesheet's own 0 then. */
    private putVar(name: string, px: number): void {
        const style = this.root.style;
        if (px !== 0) style.setProperty(name, `${px}px`);
        else style.removeProperty(name);
    }

    /**
     * Run `write` with the root's transition held off, and have the browser
     * compute the root's style as written before it runs again: a
     * transition started after moves from what was written here. Holding it
     * off cancels the transitions under way, and has what is written shown
     * at once.
     */
    private held<T>(write: () => T): T {
        const style = this.root.style;
        const transition = style.transition;
        style.transition = 'none';
        try {
            return write();
        } finally {
            const computed = this.win.getComputedStyle?.(this.root);
            computed?.getPropertyValue?.(KEYBOARD_OVERLAP_VAR);
            computed?.getPropertyValue?.(BOX_SHIFT_VAR);
            style.transition = transition;
        }
    }

    /** `name` as the root's computed style has it now, '' where it cannot be read. */
    private computed(name: string): string {
        const style = this.win.getComputedStyle?.(this.root);
        return typeof style?.getPropertyValue === 'function' ? style.getPropertyValue(name).trim() : '';
    }

    /**
     * The overlap the root lays out now (px): midway through its transition
     * while that runs. What was written where the computed style cannot be
     * read.
     */
    shownOverlap(): number {
        const raw = this.computed(KEYBOARD_OVERLAP_VAR);
        if (raw === '') return this.written;
        const px = parseFloat(raw);
        return Number.isFinite(px) ? px : this.written;
    }

    /**
     * How far the box is drawn from where it is laid out now (px): midway
     * through its transition while that runs, 0 at rest. 0 where the
     * computed style cannot be read.
     */
    shownShift(): number {
        const px = parseFloat(this.computed(BOX_SHIFT_VAR));
        return Number.isFinite(px) ? px : 0;
    }

    /**
     * Where things stand now, the box where it is seen. The keyboard's top is
     * read where the overlap shown lays it out, unless `overlap` is given: a
     * panel placed by script stands over the keyboard's own top, whatever
     * the root shows.
     */
    read(field: HTMLElement | null, overlap = this.shownOverlap()): Place {
        return this.measure(field, overlap);
    }

    /**
     * Where things will stand once the overlap has come to `overlap`, then
     * the root given `overlap` (`writeOverlap`), moving there from what it
     * shows now.
     *
     * The root's transition is held off while `overlap` is laid out and
     * read, the box laid out by it with no shift, where it comes to rest;
     * what the root shows is given back before the transition runs again: a
     * transition is started only by a change of the value with it on, so
     * the root left at `overlap` would show it at once. Holding it off
     * cancels the transitions under way; those started after run again from
     * where they stood, over the whole of their length.
     */
    readAt(overlap: number, field: HTMLElement | null): Place {
        const shown = this.shownOverlap();
        const shift = this.shownShift();
        const to = this.writtenTo;
        const scrollTop = this.body.scrollTop;
        try {
            return this.held(() => {
                try {
                    this.put(overlap);
                    this.putTo(overlap);
                    this.putShift(0);
                    return this.measure(field, overlap);
                } finally {
                    // Given back however the read ends, a throw among it, so
                    // the root is not left laid out at `overlap`, the box
                    // where it rests.
                    this.put(shown);
                    this.putTo(to);
                    this.putShift(shift);
                }
            });
        } finally {
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
     * The least padding found that lets the body scroll to `top`, at least
     * `least` px past the stylesheet's, with its height locked as it is, or
     * at `height` where it is not; and how far it then scrolls. The padding
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
     *
     * A step twice the last may take the range past `top`. The padding is
     * then lessened by what went past, down to `least`, and kept so only
     * where the body still scrolls to `top` with it: a layout lengthening
     * the range by more than the padding would be left short. Where the
     * range goes one for one with the padding, past what gave way, that is
     * the padding `top` needs; where it goes by less, some of what went past
     * is left.
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
            const past = range - top;
            if (past >= 1 && pad > least) {
                const less = Math.max(least, pad - past);
                this.pad(less);
                const back = this.range();
                if (top - back < 1) {
                    pad = less;
                    range = back;
                }
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
