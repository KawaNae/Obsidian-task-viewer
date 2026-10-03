/**
 * MiniCalendarSchema — declarative persistence schema for MiniCalendar view.
 *
 * MiniCalendar has no time axis, so it shows only moonPhase (no sunTimes)
 * in its astronomy menu — but the persisted astronomyDisplay shape is still
 * the same Partial<AstronomyDisplay>.
 */

import { F, T } from '../../services/viewConfig/FieldCodecs';
import { ViewConfigCodec } from '../../services/viewConfig/ViewConfigCodec';
import type { ViewSchema } from '../../services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { AstronomyDisplay } from '../../types';

export interface MiniCalendarConfig {
    customName?: string;
    filterState?: FilterState;
    astronomyDisplay?: Partial<AstronomyDisplay>;
}

export interface MiniCalendarTransient {
    windowStart?: string;
}

export const MiniCalendarSchema: ViewSchema<MiniCalendarConfig, MiniCalendarTransient> = {
    viewType: 'mini-calendar-view',
    shortName: 'mini-calendar',
    defaults: {},
    config: {
        customName:       F.optionalString('customName'),
        filterState:      F.filter('filterState', { legacyKeys: ['filter'] }),
        astronomyDisplay: F.astronomyDisplay('astronomyDisplay'),
    },
    anchorKey: 'windowStart',
    transient: {
        windowStart: T.dateString('windowStart'),
    },
};

/** The codec of this schema; the views, toolbars and the view table share this instance. */
export const MiniCalendarCodec = new ViewConfigCodec(MiniCalendarSchema);
