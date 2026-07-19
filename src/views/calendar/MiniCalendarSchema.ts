/**
 * MiniCalendarSchema — declarative persistence schema for MiniCalendar view.
 *
 * MiniCalendar has no time axis, so it shows only moonPhase (no sunTimes)
 * in its astronomy menu — but the persisted astronomyDisplay shape is still
 * the same Partial<AstronomyDisplay>.
 */

import { F, T } from '../../services/viewConfig/FieldCodecs';
import { registerSchema } from '../../services/viewConfig/SchemaRegistry';
import type { ViewSchema } from '../../services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { AstronomyDisplay } from '../../types';
import { VIEW_META_MINI_CALENDAR } from '../../constants/viewRegistry';

export interface MiniCalendarConfig {
    customName?: string;
    filterState?: FilterState;
    astronomyDisplay?: Partial<AstronomyDisplay>;
}

export interface MiniCalendarTransient {
    windowStart?: string;
}

export const MiniCalendarSchema: ViewSchema<MiniCalendarConfig, MiniCalendarTransient> = {
    viewType: VIEW_META_MINI_CALENDAR.type,
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

registerSchema(MiniCalendarSchema);
