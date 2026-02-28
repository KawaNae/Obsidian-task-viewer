import type { Workspace, WorkspaceLeaf } from 'obsidian';
import type { FilterState } from '../services/filter/FilterTypes';
import { hasConditions } from '../services/filter/FilterTypes';
import { FilterSerializer } from '../services/filter/FilterSerializer';
import type { PinnedListDefinition } from '../types';
import { unicodeBtoa } from './base64';

export type LeafPosition = 'left' | 'right' | 'tab' | 'window';

export interface ViewUriOptions {
    filterState?: FilterState;
    days?: number;
    zoom?: number;
    date?: string;
    pinnedLists?: PinnedListDefinition[];
    showSidebar?: boolean;
    position?: LeafPosition;
    name?: string;
}

/**
 * Builds obsidian://task-viewer URIs from view type and optional parameters.
 *
 * View display params are kept as readable query params.
 * Filter and pinnedLists are base64-encoded.
 */
export class ViewUriBuilder {
    private static readonly VIEW_SHORT_NAMES: Record<string, string> = {
        'timeline-view': 'timeline',
        'schedule-view': 'schedule',
        'calendar-view': 'calendar',
        'mini-calendar-view': 'mini-calendar',
    };

    static build(viewType: string, options?: ViewUriOptions): string {
        const shortName = this.VIEW_SHORT_NAMES[viewType];
        if (!shortName) return '';
        const opts = options ?? {};

        let uri = `obsidian://task-viewer?view=${shortName}`;

        // Position
        if (opts.position) uri += `&position=${opts.position}`;

        // Name
        if (opts.name) uri += `&name=${encodeURIComponent(opts.name)}`;

        // View display params (readable)
        if (opts.days != null) uri += `&days=${opts.days}`;
        if (opts.zoom != null) uri += `&zoom=${opts.zoom}`;
        if (opts.date != null) uri += `&date=${encodeURIComponent(opts.date)}`;
        if (opts.showSidebar != null) uri += `&showSidebar=${opts.showSidebar}`;

        // Filter (base64)
        if (opts.filterState && hasConditions(opts.filterState)) {
            uri += `&filter=${FilterSerializer.toURIParam(opts.filterState)}`;
        }

        // PinnedLists (base64)
        if (opts.pinnedLists && opts.pinnedLists.length > 0) {
            uri += `&pinnedLists=${unicodeBtoa(JSON.stringify(opts.pinnedLists))}`;
        }

        return uri;
    }

    /**
     * Detect the current position of a WorkspaceLeaf.
     */
    static detectLeafPosition(leaf: WorkspaceLeaf, workspace: Workspace): LeafPosition {
        // Walk up the parent chain to check sidebars
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
