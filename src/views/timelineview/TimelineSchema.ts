/**
 * TimelineSchema — declarative persistence schema for Timeline view.
 *
 * This is the *single* source of truth for which fields are persisted in
 * Timeline templates / workspace state / URI params. Adding a field here
 * makes it round-trip through all 5 boundaries automatically.
 */

import { F, T } from '../../services/viewConfig/FieldCodecs';
import { registerSchema } from '../../services/viewConfig/SchemaRegistry';
import type { ViewSchema } from '../../services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { PinnedListDefinition, AstronomyDisplay } from '../../types';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';

/** Timeline days-per-screen bounds. Single constant closes the upper limit
 *  everywhere it's checked (schema, toolbar stepper, CLI export-image). At
 *  495px pane width, 31 days measured at 15px/column — too narrow for a
 *  readable date label. */
export const MIN_DAYS_TO_SHOW = 1;
export const MAX_DAYS_TO_SHOW = 30;

export interface TimelineConfig {
    customName?: string;
    filterState?: FilterState;
    maskMode?: boolean;
    astronomyDisplay?: Partial<AstronomyDisplay>;
    showSidebar?: boolean;
    pinnedLists?: PinnedListDefinition[];
    daysToShow?: number;
    zoomLevel?: number;
    /** Per-view override of all-day section visibility. undefined = follow global. */
    showAllDay?: boolean;
    /** Per-view override of timeline section visibility. undefined = follow global. */
    showTimeline?: boolean;
}

export interface TimelineTransient {
    /** URI-seedable initial date. workspace persistence is intentional no-op:
     *  TimelineView recomputes startDate on every onOpen from visualToday. */
    startDate?: string;
    pinnedListCollapsed?: Record<string, boolean>;
}

export const TimelineSchema: ViewSchema<TimelineConfig, TimelineTransient> = {
    viewType: VIEW_META_TIMELINE.type,
    shortName: 'timeline',
    defaults: {
        daysToShow: 3,
        zoomLevel: 1.0,
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
        daysToShow:       F.int('daysToShow', { min: MIN_DAYS_TO_SHOW, max: MAX_DAYS_TO_SHOW, legacyKeys: ['days'] }),
        zoomLevel:        F.float('zoomLevel', { min: 0.25, max: 10, legacyKeys: ['zoom'] }),
        showAllDay:       F.boolean('showAllDay'),
        showTimeline:     F.boolean('showTimeline'),
    },
    anchorKey: 'startDate',
    transient: {
        startDate:               T.dateString('startDate', { legacyKeys: ['date'] }),
        pinnedListCollapsed:     T.collapsedKeys('pinnedListCollapsed', 'timeline'),
    },
};

registerSchema(TimelineSchema);
