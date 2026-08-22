import type { App, Workspace, WorkspaceLeaf } from 'obsidian';
import type { DefaultLeafPosition, TaskViewerSettings } from '../../types';
import type { ViewType } from '../../constants/viewRegistry';

/**
 * Where a view is asked to open.
 *
 * `DefaultLeafPosition` is the settings-level vocabulary; a URI can also say
 * `override`, meaning "reuse the leaf this view is already in, if there is
 * one". The union was written out longhand in three signatures before it had
 * a name.
 */
export type LeafPosition = DefaultLeafPosition | 'tab' | 'window' | 'override';

const LEAF_POSITIONS: ReadonlySet<string> = new Set<LeafPosition>([
    'left', 'right', 'tab', 'window', 'override',
]);

/** A position read from untrusted text (a URI query), or undefined if it isn't one. */
export function parseLeafPosition(raw: string | undefined): LeafPosition | undefined {
    return raw && LEAF_POSITIONS.has(raw) ? raw as LeafPosition : undefined;
}

/**
 * Which settings field holds each view's home.
 *
 * Two vocabularies meet here — Obsidian's view types and the settings field
 * names — so the table is typed against both. A view type added to the
 * registry without a home to open in is a compile error rather than a silent
 * slide into the right sidebar.
 */
const POSITION_FIELD: Record<ViewType, keyof TaskViewerSettings['defaultViewPositions']> = {
    'timeline-view': 'timeline',
    'schedule-view': 'schedule',
    'calendar-view': 'calendar',
    'mini-calendar-view': 'miniCalendar',
    'timer-view': 'timer',
    'kanban-view': 'kanban',
};

/**
 * The home the settings give this view.
 *
 * Views outside the registry — the log view is the only one — have no
 * configurable home and open on the right.
 */
export function defaultPositionFor(
    settings: TaskViewerSettings, viewType: string,
): DefaultLeafPosition {
    const field = POSITION_FIELD[viewType as ViewType];
    return field ? settings.defaultViewPositions[field] : 'right';
}

/**
 * Open `viewType` in a leaf and seed it with `state`.
 *
 * The single way a Task Viewer view gets opened: the ribbon and commands
 * arrive with no position and no state, the URI handler arrives with both.
 *
 * The three branches differ in what a second open means. An explicit position
 * always makes the leaf that position describes. `override` reuses the view's
 * existing leaf, so a URI fired twice re-aims one pane instead of stacking
 * panes. With nothing said, the first open goes to the view's configured home
 * and every open after that gets a new tab — asking twice is read as wanting
 * two.
 */
export async function openLeafFromState(
    app: App,
    settings: TaskViewerSettings,
    viewType: string,
    position: LeafPosition | undefined,
    state: Record<string, unknown>,
): Promise<void> {
    const { workspace } = app;

    let leaf: WorkspaceLeaf | null = null;

    if (position === 'override') {
        const leaves = workspace.getLeavesOfType(viewType);
        leaf = leaves.length > 0
            ? leaves[0]
            : leafAt(workspace, defaultPositionFor(settings, viewType));
    } else if (position) {
        leaf = leafAt(workspace, position);
    } else {
        const leaves = workspace.getLeavesOfType(viewType);
        leaf = leaves.length === 0
            ? leafAt(workspace, defaultPositionFor(settings, viewType))
            : workspace.getLeaf(true);
    }

    if (leaf) {
        await leaf.setViewState({ type: viewType, active: true, state });
        workspace.revealLeaf(leaf);
    }
}

function leafAt(
    workspace: Workspace, position: Exclude<LeafPosition, 'override'>,
): WorkspaceLeaf | null {
    switch (position) {
        case 'left':   return workspace.getLeftLeaf(false);
        case 'right':  return workspace.getRightLeaf(false);
        case 'tab':    return workspace.getLeaf('tab');
        case 'window': return workspace.getLeaf('window');
    }
}
