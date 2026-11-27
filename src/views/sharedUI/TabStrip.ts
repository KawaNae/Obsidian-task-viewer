import { setIcon } from 'obsidian';
import { showsOnly } from './PressCommit';

/** A tab: its id, the name it shows, and an icon before the name (Obsidian's icon name), if it has one. */
export interface TabSpec<K extends string> {
    id: K;
    label: string;
    icon?: string;
}

export interface TabStripOptions<K extends string> {
    /** The tab chosen as the strip is built. */
    initial: K;
    /** Told once another tab has been chosen, as the user's way back to it (a form drawn again opens on it). */
    onSelect?: (id: K) => void;
}

/** How many strips were built: each gives its tabs and panes ids of its own. */
let built = 0;

/**
 * A row of tabs over the panes they choose between, knowing nothing of what
 * the panes hold.
 *
 * - The row and the element of the panes (`tv-tabs__panes`) are built in
 *   that order at the end of the parent, for the stylesheet of the place it
 *   is used in to find them there.
 * - The row is as wide as its place. Where it lays its tabs wider than
 *   that and scrolls (a place's stylesheet may), the button of the tab
 *   chosen is scrolled into the row's sight, as the strip is built, as
 *   another is chosen, and as the row's width changes (the panes' contents
 *   drawn after the strip may give its place a scrollbar): the row alone is
 *   scrolled, not what holds it.
 * - Each tab is a `button` (`role="tab"`) naming its tab's id (`data-tab`),
 *   so a tab is found by what it is, not by the ids the strip numbers. Enter
 *   and Space choose it as a button's own keys; the arrows go to the next
 *   and the previous tab, round at the ends, Home and End to the first and
 *   the last, choosing it and moving the focus to its button. The tab
 *   chosen alone is in the Tab order (`tabindex`), so Tab goes from it into
 *   its pane.
 * - Every pane is built once and kept: what was typed in one stays as
 *   another is chosen. The panes not chosen are marked off, `inert` (out of
 *   the Tab order and of what assistive technology reads, their fields
 *   taking no focus) and `is-hidden`; how a pane off is hidden, and whether
 *   the panes keep one height, is the stylesheet's of the place it is used in.
 * - A focus in the pane left would be lost to `inert`, to wherever the
 *   browser puts it: it goes to the button of the tab chosen instead
 *   ({@link carryFocus}). A focus on the row, or outside the panes, stays.
 * - {@link reveal} chooses the tab of an element its caller is about to put
 *   the focus on, which a pane off would not take; the focus is the
 *   caller's to put. {@link focusTab} chooses a tab and puts the focus on
 *   its button, as the arrows do, for a caller with no field to put it on.
 */
export class TabStrip<K extends string> {
    private readonly list: HTMLElement;
    private readonly tabs = new Map<K, { button: HTMLElement; pane: HTMLElement }>();
    private readonly order: K[];
    private current: K;

    /** Build at the end of `parent` the row of tabs, and after it the element of a pane for each tab. */
    constructor(parent: HTMLElement, specs: readonly TabSpec<K>[], private readonly opts: TabStripOptions<K>) {
        const prefix = `tv-tabs-${++built}`;
        const list = this.list = parent.createDiv({ cls: 'tv-tabs' });
        list.setAttribute('role', 'tablist');
        const panes = parent.createDiv({ cls: 'tv-tabs__panes' });
        this.order = specs.map(spec => spec.id);
        for (const spec of specs) {
            const tabId = `${prefix}-tab-${spec.id}`;
            const paneId = `${prefix}-pane-${spec.id}`;
            const button = list.createEl('button', {
                cls: 'tv-tabs__tab',
                attr: { type: 'button', role: 'tab', id: tabId, 'aria-controls': paneId, 'data-tab': spec.id },
            });
            if (spec.icon) setIcon(button.createSpan({ cls: 'tv-tabs__icon' }), spec.icon);
            button.createSpan({ cls: 'tv-tabs__label', text: spec.label });
            button.addEventListener('click', () => this.select(spec.id));
            // A tab shows another pane: what is typed stays in its field, read or not.
            showsOnly(button);
            button.addEventListener('keydown', (e) => this.onKey(e, spec.id));
            const pane = panes.createDiv({ cls: 'tv-tabs__pane' });
            pane.setAttribute('role', 'tabpanel');
            pane.setAttribute('id', paneId);
            pane.setAttribute('aria-labelledby', tabId);
            this.tabs.set(spec.id, { button, pane });
        }
        this.current = opts.initial;
        this.mark();
        const Observer = list.ownerDocument?.defaultView?.ResizeObserver;
        if (Observer) new Observer(() => this.scrollToChosen()).observe(list);
    }

    /** The pane of the tab `id`: what it holds is built there by the strip's user. */
    pane(id: K): HTMLElement {
        return this.tabs.get(id)!.pane;
    }

    get selected(): K {
        return this.current;
    }

    /** Choose the tab `id`, as a click on it does. */
    select(id: K): void {
        this.choose(id, true);
    }

    /**
     * Choose the tab whose pane holds `el`, moving no focus: the caller puts
     * it on `el` next. Whether a pane holds it.
     */
    reveal(el: Element): boolean {
        for (const [id, { pane }] of this.tabs) {
            if (!pane.contains(el)) continue;
            this.choose(id, false);
            return true;
        }
        return false;
    }

    /** Choose the tab `id` and put the focus on its button, which raises no on-screen keyboard: as the arrows go to it. */
    focusTab(id: K): void {
        this.select(id);
        this.focusButton(id);
    }

    private choose(id: K, carry: boolean): void {
        if (id === this.current) return;
        const left = this.pane(this.current);
        if (carry) this.carryFocus(left, id);
        this.current = id;
        this.mark();
        this.opts.onSelect?.(id);
    }

    /**
     * Where a focus in the pane `left` goes as the tab `to` is chosen: to its
     * button, which raises no on-screen keyboard (a keyboard up for a field
     * in the pane left goes down).
     */
    private carryFocus(left: HTMLElement, to: K): void {
        const active = left.ownerDocument.activeElement;
        if (active && left.contains(active)) this.focusButton(to);
    }

    private onKey(e: KeyboardEvent, from: K): void {
        const at = this.order.indexOf(from);
        const last = this.order.length - 1;
        const to = e.key === 'ArrowRight' ? (at === last ? 0 : at + 1)
            : e.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
            : e.key === 'Home' ? 0
            : e.key === 'End' ? last
            : null;
        if (to === null) return;
        e.preventDefault();
        this.focusTab(this.order[to]);
    }

    private focusButton(id: K): void {
        this.tabs.get(id)?.button.focus();
    }

    /** Mark the tab chosen and its pane on, the others off. */
    private mark(): void {
        for (const [id, { button, pane }] of this.tabs) {
            const on = id === this.current;
            button.toggleClass('is-active', on);
            button.setAttribute('aria-selected', String(on));
            button.setAttribute('tabindex', on ? '0' : '-1');
            pane.toggleClass('is-hidden', !on);
            if (on) pane.removeAttribute('inert');
            else pane.setAttribute('inert', '');
        }
        this.scrollToChosen();
    }

    /** Scroll the row, if its tabs go past its edges, until the button of the tab chosen is all in sight. */
    private scrollToChosen(): void {
        const button = this.tabs.get(this.current)?.button;
        if (!button) return;
        const row = this.list.getBoundingClientRect();
        const tab = button.getBoundingClientRect();
        if (tab.left < row.left) this.list.scrollLeft -= row.left - tab.left;
        else if (tab.right > row.right) this.list.scrollLeft += tab.right - row.right;
    }
}
