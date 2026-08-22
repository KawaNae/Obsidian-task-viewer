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
 * `refresh()` is this plugin's own convention for "redraw yourself", not an
 * Obsidian one, so no Obsidian type mentions it. Naming the shape says which
 * method we are reaching for; `as any` said only that we had given up.
 */
interface RefreshableView extends View {
    refresh?: () => void;
}

/** Ask a view to redraw, if it is one of ours. */
export function refreshView(view: View): void {
    (view as RefreshableView).refresh?.();
}
