/**
 * When a toolbar folds its action zone into ⋮ (`is-compact` on its root):
 * when its row, laid out open, does not fit the width it is given.
 *
 * Two widths decide it, each measured where it changes:
 *   - the width the toolbar needs open, its max-content width with the action
 *     zone shown and ⋮ hidden. It changes with what the toolbar holds (the
 *     month's name, a label, a button put in or taken out, the language), so
 *     it is measured again on each change of the toolbar's DOM
 *     (MutationObserver). Measured open whatever the toolbar shows, so
 *     folding, which frees room, never unfolds it, and unfolding never
 *     overflows it.
 *   - the width the toolbar has, its own box. It changes with the pane, so it
 *     is read on each resize (ResizeObserver). Folding does not change it.
 *
 * A toolbar out of sight (a tab behind another, a toolbar lifted out between
 * draws) has no width: nothing is decided then, and the width it needs is
 * measured again once it is seen.
 */
export class ToolbarFold {
    private root: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private mutationObserver: MutationObserver | null = null;
    /** The width the toolbar needs open; null until measured in sight. */
    private needed: number | null = null;

    /** Watch `root` and fold it as it fits. Again for the same root is a no-op. */
    attach(root: HTMLElement): void {
        if (this.root === root) return;
        this.detach();
        this.root = root;
        const resizeObserver = new ResizeObserver(() => this.decide());
        resizeObserver.observe(root);
        this.resizeObserver = resizeObserver;
        // Attributes are left out: folding and measuring write the root's
        // class and style, and must not set off another measure.
        const mutationObserver = new MutationObserver(() => this.remeasure());
        mutationObserver.observe(root, { childList: true, subtree: true, characterData: true });
        this.mutationObserver = mutationObserver;
        this.remeasure();
    }

    /** Stop watching (the view closes). The root keeps the fold it has. */
    detach(): void {
        this.resizeObserver?.disconnect();
        this.mutationObserver?.disconnect();
        this.resizeObserver = null;
        this.mutationObserver = null;
        this.root = null;
        this.needed = null;
    }

    /** Measure the width needed open, then decide. */
    private remeasure(): void {
        const root = this.root;
        if (!root) return;
        const needed = measureOpenWidth(root);
        this.needed = needed > 0 ? needed : null;
        this.decide(false);
    }

    /**
     * Fold or unfold to the width the toolbar has now. A toolbar seen for the
     * first time since it was out of sight is measured first.
     */
    private decide(measureIfUnknown = true): void {
        const root = this.root;
        if (!root) return;
        const available = root.getBoundingClientRect().width;
        if (measureIfUnknown && available > 0 && this.needed === null) {
            this.remeasure();
            return;
        }
        const compact = foldsAt(available, this.needed, root.hasClass('is-compact'));
        root.toggleClass('is-compact', compact);
    }
}

/**
 * Whether the toolbar folds, given the width it has (`available`), the width
 * it needs open (`needed`, null when not known) and whether it is folded now.
 * Out of sight (no width) or not measured, it stays as it is. It fits when it
 * needs no more than it has.
 */
export function foldsAt(available: number, needed: number | null, current: boolean): boolean {
    if (!(available > 0) || needed === null) return current;
    return needed > available;
}

/**
 * The width `root` takes open at its max-content width: the class that folds
 * it off and its width set to max-content, read, and both put back before the
 * frame is drawn, so nothing of it is seen. 0 out of sight.
 */
function measureOpenWidth(root: HTMLElement): number {
    const wasCompact = root.hasClass('is-compact');
    const width = root.style.width;
    root.removeClass('is-compact');
    root.style.width = 'max-content';
    const needed = root.getBoundingClientRect().width;
    root.style.width = width;
    if (wasCompact) root.addClass('is-compact');
    return needed;
}
