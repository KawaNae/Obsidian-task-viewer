/**
 * TimelineSchema — declarative persistence schema for Timeline view.
 *
 * This is the *single* source of truth for which fields are persisted in
 * Timeline templates / workspace state / URI params. Adding a field here
 * makes it round-trip through all 5 boundaries automatically.
 */

import { F, T } from '../../services/viewConfig/FieldCodecs';
import { ViewConfigCodec } from '../../services/viewConfig/ViewConfigCodec';
import type { ViewSchema } from '../../services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { PinnedListDefinition, AstronomyDisplay } from '../../types';

/** Timeline days-per-screen bounds. Single constant closes the upper limit
 *  everywhere it's checked (schema, toolbar stepper, CLI export-image). At
 *  495px pane width, 31 days measured at 15px/column — too narrow for a
 *  readable date label. */
export const MIN_DAYS_TO_SHOW = 1;
export const MAX_DAYS_TO_SHOW = 30;
const DEFAULT_DAYS_TO_SHOW = 3;

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
    /**
     * The day the view looks at, drawn with the past days before it
     * (`TimelineDays`). Absent, the view follows today. The workspace saves
     * it, so a view on a fixed day reopens there; a URI and the CLI's
     * `anchor-date` set it.
     */
    date?: string;
    pinnedListCollapsed?: Record<string, boolean>;
}

/** The view's state: its config and transient fields as one value (`ViewStore`). */
export type TimelineState = Partial<TimelineConfig> & Partial<TimelineTransient>;

export const TimelineSchema: ViewSchema<TimelineConfig, TimelineTransient> = {
    viewType: 'timeline-view',
    shortName: 'timeline',
    defaults: {
        daysToShow: DEFAULT_DAYS_TO_SHOW,
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
    anchorKey: 'date',
    listsOf: (config) => config.pinnedLists ?? [],
    transient: {
        date:                    T.dateString('date'),
        pinnedListCollapsed:     T.collapsedKeys('pinnedListCollapsed', 'timeline'),
    },
};

/** The codec of this schema; the views, toolbars and the view table share this instance. */
export const TimelineCodec = new ViewConfigCodec(TimelineSchema);

/** The zoom drawn: the view's own, or the global setting. */
export function effectiveZoom(state: Readonly<TimelineState>, settings: { zoomLevel: number }): number {
    return state.zoomLevel ?? settings.zoomLevel;
}

/** The days per screen drawn. */
export function daysToShowOf(state: Readonly<TimelineState>): number {
    return state.daysToShow ?? DEFAULT_DAYS_TO_SHOW;
}
