import { ItemView, type View, type WorkspaceLeaf } from 'obsidian';

/**
 * The content element of a leaf's view, or undefined when the view has none.
 *
 * `View` declares only `containerEl`; `contentEl` arrives with `ItemView`,
 * which every view this plugin opens extends. Five call sites used to write
 * `(leaf.view as any).contentEl` — the cast was standing in for this
 * question, and answered it wrong for a leaf holding some other view.
 */
export function viewContentEl(leaf: WorkspaceLeaf): HTMLElement | undefined {
    return leaf.view instanceof ItemView ? leaf.view.contentEl : undefined;
}

/**
 * The three events a view of ours hears from the plugin. Neither is an Obsidian
 * convention, so no Obsidian type mentions them; naming the shape says which
 * method we are reaching for.
 *
 * - `redraw()` — something the view draws from changed (settings saved). The
 *   view keeps where it is: the dates it shows, its scroll.
 * - `onDayRolled()` — the visual day changed. Each view decides what following
 *   the new day means; one without its own answer just redraws.
 * - `onMinute()` — a minute passed (the plugin's one clock, `MinuteClock`). A
 *   view that draws the time of day (the now-line) moves it; others ignore it.
 *
 * They used to share one name, `refresh()`, whose meaning differed by view:
 * Timeline and Schedule went back to today on it, so every settings save
 * moved them off the day the user was looking at.
 */
interface TaskViewerView extends View {
    redraw?: () => void;
    onDayRolled?: () => void;
    onMinute?: () => void;
}

/** Tell a view of ours that settings changed: redraw in place. */
export function redrawView(view: View): void {
    (view as TaskViewerView).redraw?.();
}

/** Tell a view of ours that the visual day changed. */
export function notifyDayRolled(view: View): void {
    const v = view as TaskViewerView;
    if (v.onDayRolled) v.onDayRolled();
    else v.redraw?.();
}

/** Tell a view of ours that a minute passed. */
export function notifyMinute(view: View): void {
    (view as TaskViewerView).onMinute?.();
}
