/**
 * ScheduleSchema — declarative persistence schema for Schedule view.
 */

import { F, T, registerSchema, type ViewSchema } from '../../services/viewConfig';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { AstronomyDisplay } from '../../types';
import { VIEW_META_SCHEDULE } from '../../constants/viewRegistry';

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
    viewType: VIEW_META_SCHEDULE.type,
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
    transient: {
        currentDate:             T.dateString('currentDate'),
    },
};

registerSchema(ScheduleSchema);
