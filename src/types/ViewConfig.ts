/**
 * Configuration a view persists: what its pinned lists hold, what a card's
 * top-right corner says, and what a saved view template carries.
 *
 * Per-view *runtime* state does not live here — it belongs to the view that
 * owns it (see `views/timelineview/TimelineViewState.ts`).
 */
import type { FilterState } from '../services/filter/FilterTypes';
import type { SortState } from '../services/sort/SortTypes';

export interface TopRightConfig {
    fields: string[];
    separator: string;
    prefix?: string;
    suffix?: string;
}

export interface PinnedListDefinition {
    id: string;
    name: string;
    filterState: FilterState;
    sortState?: SortState;
    applyViewFilter?: boolean;
    topRight?: TopRightConfig;
}

export interface ViewTemplateSummary {
    filePath: string;
    name: string;
    viewType: string;
}

export interface ViewTemplate extends ViewTemplateSummary {
    /**
     * Per-view configuration dict — the JSON code block in the template
     * `.md` file is exactly this object. Each view's ViewConfigCodec parses
     * and serializes this shape; adding a new persisted field is a one-line
     * change in the per-view schema declaration.
     */
    config?: Record<string, unknown>;
}
