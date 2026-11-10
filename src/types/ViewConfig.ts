/**
 * Configuration a view persists: what its saved lists and the frames of its
 * sidebar hold, what a card's top-right corner says, and what a saved view
 * template carries.
 *
 * A view's own state does not live here — it is the config and transient
 * fields of the view's schema, held by the view (`views/base/ViewStore.ts`).
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
    applyViewFilter: boolean;
    topRight?: TopRightConfig;
}

/**
 * A frame of the sidebar of Timeline and Calendar that shows a saved list:
 * the list's definition itself, marked with its kind. Kanban's cells are
 * lists, not frames, and hold the bare definition.
 */
export interface ListFrame extends PinnedListDefinition {
    kind: 'list';
}

/**
 * One frame of the sidebar. The sidebar stacks its frames in the order the
 * view's state holds them, and `kind` says what a frame shows. Every kind
 * keeps its `id` and its `name` at the top, so a frame is collapsed, moved
 * and removed by its id without its kind being read.
 */
export type SidebarFrame = ListFrame;

/** `list` as a frame of the sidebar. */
export function listFrame(list: PinnedListDefinition): ListFrame {
    return { ...list, kind: 'list' };
}

/** The frames among `frames` that show a list, in their order. */
export function listFramesOf(frames: readonly SidebarFrame[]): ListFrame[] {
    return frames.filter((frame): frame is ListFrame => frame.kind === 'list');
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
