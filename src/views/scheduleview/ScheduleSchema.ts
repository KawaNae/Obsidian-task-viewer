/**
 * ScheduleSchema — declarative persistence schema for Schedule view.
 */

import { F, T } from '../../services/viewConfig/FieldCodecs';
import { ViewConfigCodec } from '../../services/viewConfig/ViewConfigCodec';
import type { ViewSchema } from '../../services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { AstronomyDisplay } from '../../types';

export interface ScheduleConfig {
    customName?: string;
    filterState?: FilterState;
    maskMode?: boolean;
    astronomyDisplay?: Partial<AstronomyDisplay>;
}

export interface ScheduleTransient {
    currentDate?: string;
}

export const ScheduleSchema: ViewSchema<ScheduleConfig, ScheduleTransient> = {
    viewType: 'schedule-view',
    shortName: 'schedule',
    defaults: {
        maskMode: false,
    },
    config: {
        customName:       F.optionalString('customName'),
        filterState:      F.filter('filterState', { legacyKeys: ['filter'] }),
        maskMode:         F.boolean('maskMode'),
        astronomyDisplay: F.astronomyDisplay('astronomyDisplay'),
    },
    anchorKey: 'currentDate',
    transient: {
        currentDate:             T.dateString('currentDate'),
    },
};

/** The codec of this schema; the views, toolbars and the view table share this instance. */
export const ScheduleCodec = new ViewConfigCodec(ScheduleSchema);
