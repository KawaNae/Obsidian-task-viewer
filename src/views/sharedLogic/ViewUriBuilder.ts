import type { Workspace, WorkspaceLeaf } from 'obsidian';

export type LeafPosition = 'left' | 'right' | 'tab' | 'window' | 'override';

export interface ViewUriOptions {
    position?: LeafPosition;
    name?: string;
    template?: string;
    mode?: string;             // timer-only
    intervalTemplate?: string; // timer-only
    /**
     * Every persisted ViewConfig field encoded as URI params, produced by
     * `codec.toUriParams` — the single source for days/zoom/date/showSidebar/
     * filter/pinnedLists/grid/maskMode/astronomyDisplay/... Omitted when
     * `template` is set (config then lives in the referenced .md file).
     */
    configParams?: Record<string, string>;
}

/**
 * Builds obsidian://task-viewer URIs.
 *
 * Schema-external params (position/name/template/mode/intervalTemplate) are
 * hand-coded here; every ViewConfig field flows through `configParams`
 * (codec.toUriParams), so this builder shares the single codec vocabulary with
 * the read path (codec.fromUriParams), template files, and workspace state —
 * one schema declaration drives all boundaries. Old URIs (days/zoom/date/
 * filter) remain readable via the codec's legacyKeys.
 */
export class ViewUriBuilder {
    private static readonly VIEW_SHORT_NAMES: Record<string, string> = {
        'timeline-view': 'timeline',
        'schedule-view': 'schedule',
        'calendar-view': 'calendar',
        'mini-calendar-view': 'mini-calendar',
        'timer-view': 'timer',
        'kanban-view': 'kanban',
    };

    static build(viewType: string, options?: ViewUriOptions): string {
        const shortName = this.VIEW_SHORT_NAMES[viewType];
        if (!shortName) return '';
        const opts = options ?? {};

        let uri = `obsidian://task-viewer?view=${shortName}`;

        // Schema-external params (not part of any ViewConfig schema).
        if (opts.position) uri += `&position=${opts.position}`;
        if (opts.name) uri += `&name=${encodeURIComponent(opts.name)}`;
        if (opts.mode) uri += `&mode=${opts.mode}`;
        if (opts.intervalTemplate) uri += `&intervalTemplate=${encodeURIComponent(opts.intervalTemplate)}`;

        // Config: a template reference replaces inline config; otherwise the
        // codec is the single source for every persisted field.
        if (opts.template) {
            uri += `&template=${encodeURIComponent(opts.template)}`;
        } else if (opts.configParams) {
            for (const [k, v] of Object.entries(opts.configParams)) {
                uri += `&${k}=${encodeURIComponent(v)}`;
            }
        }

        return uri;
    }

    /**
     * Detect the current position of a WorkspaceLeaf.
     */
    static detectLeafPosition(leaf: WorkspaceLeaf, workspace: Workspace): LeafPosition {
        // Walk up the parent chain to check sidebars
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let item: any = leaf;
        while (item?.parent) {
            if (item === workspace.leftSplit || item.parent === workspace.leftSplit) return 'left';
            if (item === workspace.rightSplit || item.parent === workspace.rightSplit) return 'right';
            item = item.parent;
        }

        // If not in a sidebar, check if it's a popout window
        const container = leaf.getContainer();
        if (container !== workspace.rootSplit) return 'window';

        return 'tab';
    }
}
