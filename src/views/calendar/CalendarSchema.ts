/**
 * CalendarSchema — declarative persistence schema for Calendar view.
 */

import { F, T } from '../../services/viewConfig/FieldCodecs';
import { ViewConfigCodec } from '../../services/viewConfig/ViewConfigCodec';
import type { ViewSchema } from '../../services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { PinnedListDefinition, AstronomyDisplay } from '../../types';

export interface CalendarConfig {
    customName?: string;
    filterState?: FilterState;
    maskMode?: boolean;
    astronomyDisplay?: Partial<AstronomyDisplay>;
    showSidebar?: boolean;
    pinnedLists?: PinnedListDefinition[];
}

export interface CalendarTransient {
    /**
     * The day the grid starts on: its week is the top row (`CalendarGrid`).
     * Absent, the view follows today and draws today's month grid.
     */
    date?: string;
    pinnedListCollapsed?: Record<string, boolean>;
}

/** The view's state: its config and transient fields as one value (`ViewStore`). */
export type CalendarState = Partial<CalendarConfig> & Partial<CalendarTransient>;

export const CalendarSchema: ViewSchema<CalendarConfig, CalendarTransient> = {
    viewType: 'calendar-view',
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
    anchorKey: 'date',
    listsOf: (config) => config.pinnedLists ?? [],
    transient: {
        date:                T.dateString('date'),
        pinnedListCollapsed: T.collapsedKeys('pinnedListCollapsed', 'calendar'),
    },
};

/** The codec of this schema; the views, toolbars and the view table share this instance. */
export const CalendarCodec = new ViewConfigCodec(CalendarSchema);
