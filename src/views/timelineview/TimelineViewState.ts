/**
 * The Timeline view's own persisted state.
 *
 * It sat in `types` among the shared vocabulary, but only Timeline ever read
 * it — the fields say so: a start date, how many days to show, a zoom level.
 * It lives with the view that owns it.
 */
import type { FilterState } from '../../services/filter/FilterTypes';
import type { AstronomyDisplay, PinnedListDefinition } from '../../types';

export interface ViewState {
    startDate: string;
    daysToShow: number;
    showSidebar: boolean;
    filterState?: FilterState;
    zoomLevel?: number;
    pinnedListCollapsed?: Record<string, boolean>;
    pinnedLists?: PinnedListDefinition[];
    customName?: string;
    /** Per-leaf "mask mode" toggle. When true, the renderer substitutes each
     * card's content with the task's `tv-mask` value (live, not export-only). */
    maskMode?: boolean;
    /** Per-instance override of astronomy display flags. undefined fields fall
     *  back to settings.astronomy.display. */
    astronomyDisplay?: Partial<AstronomyDisplay>;
    /** Per-view override of all-day section visibility. undefined = follow global. */
    showAllDay?: boolean;
    /** Per-view override of timeline section visibility. undefined = follow global. */
    showTimeline?: boolean;
}
