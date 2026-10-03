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
     * The day looked at, as given (`ViewedDay`). Absent, the view follows
     * today. The grid drawn is this day's month grid (`CalendarGrid`).
     */
    date?: string;
    /** How many weeks the grid was moved from `date`'s month grid; absent is 0. */
    weekOffset?: number;
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
    anchorOffsetKeys: ['weekOffset'],
    listsOf: (config) => config.pinnedLists ?? [],
    transient: {
        date:                T.dateString('date'),
        weekOffset:          T.int('weekOffset'),
        pinnedListCollapsed: T.collapsedKeys('pinnedListCollapsed', 'calendar'),
    },
};

/** The codec of this schema; the views, toolbars and the view table share this instance. */
export const CalendarCodec = new ViewConfigCodec(CalendarSchema);
