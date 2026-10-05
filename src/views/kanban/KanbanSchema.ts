/**
 * KanbanSchema — declarative persistence schema for Kanban view.
 *
 * Kanban has no astronomy overlay (no time axis) so astronomyDisplay is not
 * a field. It uses a 2D `grid` of PinnedListDefinition[] instead of the flat
 * pinnedLists used by Timeline/Calendar.
 */

import { F, T } from '../../services/viewConfig/FieldCodecs';
import { ViewConfigCodec } from '../../services/viewConfig/ViewConfigCodec';
import type { ViewSchema } from '../../services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { PinnedListDefinition } from '../../types';

export interface KanbanConfig {
    customName?: string;
    filterState?: FilterState;
    maskMode?: boolean;
    grid?: PinnedListDefinition[][];
}

export interface KanbanTransient {
    gridCollapsed?: Record<string, boolean>;
}

/** The view's state: its config and transient fields as one value (`ViewStore`). */
export type KanbanState = Partial<KanbanConfig> & Partial<KanbanTransient>;

export const KanbanSchema: ViewSchema<KanbanConfig, KanbanTransient> = {
    viewType: 'kanban-view',
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
    // Row by row, left to right: the order the board is read in.
    listsOf: (config) => (config.grid ?? []).flat(),
    transient: {
        gridCollapsed: T.collapsedKeys('gridCollapsed'),
    },
};

/** The codec of this schema; the views, toolbars and the view table share this instance. */
export const KanbanCodec = new ViewConfigCodec(KanbanSchema);
