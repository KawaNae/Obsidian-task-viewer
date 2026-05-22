/**
 * KanbanSchema — declarative persistence schema for Kanban view.
 *
 * Kanban has no astronomy overlay (no time axis) so astronomyDisplay is not
 * a field. It uses a 2D `grid` of PinnedListDefinition[] instead of the flat
 * pinnedLists used by Timeline/Calendar.
 */

import { F, T, registerSchema, type ViewSchema } from '../../services/viewConfig';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { PinnedListDefinition } from '../../types';
import { VIEW_META_KANBAN } from '../../constants/viewRegistry';

export interface KanbanConfig {
    customName?: string;
    filterState?: FilterState;
    maskMode?: boolean;
    grid?: PinnedListDefinition[][];
}

export interface KanbanTransient {
    gridCollapsed?: Record<string, boolean>;
}

export const KanbanSchema: ViewSchema<KanbanConfig, KanbanTransient> = {
    viewType: VIEW_META_KANBAN.type,
    shortName: 'kanban',
    defaults: {
        maskMode: false,
    },
    config: {
        customName:  F.optionalString('customName'),
        filterState: F.filter('filterState', { legacyKeys: ['filter'] }),
        maskMode:    F.boolean('maskMode'),
        grid:        F.grid('grid'),
    },
    transient: {
        gridCollapsed: T.collapsedKeys('gridCollapsed'),
    },
};

registerSchema(KanbanSchema);
