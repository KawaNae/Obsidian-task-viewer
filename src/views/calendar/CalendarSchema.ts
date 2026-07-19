/**
 * CalendarSchema — declarative persistence schema for Calendar view.
 */

import { F, T } from '../../services/viewConfig/FieldCodecs';
import { registerSchema } from '../../services/viewConfig/SchemaRegistry';
import type { ViewSchema } from '../../services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { PinnedListDefinition, AstronomyDisplay } from '../../types';
import { VIEW_META_CALENDAR } from '../../constants/viewRegistry';

export interface CalendarConfig {
    customName?: string;
    filterState?: FilterState;
    maskMode?: boolean;
    astronomyDisplay?: Partial<AstronomyDisplay>;
    showSidebar?: boolean;
    pinnedLists?: PinnedListDefinition[];
}

export interface CalendarTransient {
    windowStart?: string;
    pinnedListCollapsed?: Record<string, boolean>;
}

export const CalendarSchema: ViewSchema<CalendarConfig, CalendarTransient> = {
    viewType: VIEW_META_CALENDAR.type,
    shortName: 'calendar',
    defaults: {
        showSidebar: true,
        maskMode: false,
    },
    config: {
        customName:       F.optionalString('customName'),
        filterState:      F.filter('filterState', { legacyKeys: ['filter'] }),
        maskMode:         F.boolean('maskMode'),
        astronomyDisplay: F.astronomyDisplay('astronomyDisplay'),
        showSidebar:      F.boolean('showSidebar'),
        pinnedLists:      F.pinnedLists('pinnedLists'),
    },
    anchorKey: 'windowStart',
    transient: {
        windowStart:         T.dateString('windowStart'),
        pinnedListCollapsed: T.collapsedKeys('pinnedListCollapsed', 'calendar'),
    },
};

registerSchema(CalendarSchema);
