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
 * A frame of the sidebar that shows a section of a note as markdown: one
 * heading's, or the whole note. It has no name of its own: its row shows
 * the heading's text, or the note's name.
 */
export interface MarkdownFrame {
    kind: 'markdown';
    id: string;
    /**
     * What it shows, written as a link's destination is: the note before
     * the first `#`, the heading after it (`Folder/Note#Heading`, or
     * `Note#Parent#Child` for a heading named from one above it). Without a
     * `#` it is the whole note. The note is found as a link's is, so a full
     * path without its `.md` and a shorter name both name one.
     */
    link: string;
}

/**
 * One frame of the sidebar. The sidebar stacks its frames in the order the
 * view's state holds them, and `kind` says what a frame shows. Every kind
 * keeps its `id` at the top, so a frame is collapsed, moved and removed by
 * its id without its kind being read. Nothing else is common to the kinds.
 */
export type SidebarFrame = ListFrame | MarkdownFrame;

/** `list` as a frame of the sidebar. */
export function listFrame(list: PinnedListDefinition): ListFrame {
    return { ...list, kind: 'list' };
}

/**
 * Where a new frame of the sidebar goes: at the end of the stack, or right
 * above or below the frame `id`.
 */
export type FrameSlot = { at: 'end' } | { at: 'above' | 'below'; id: string };

/**
 * `frames` with `frame` put in `slot`. The frame a slot is beside is found by
 * its id in `frames`, so a slot named before the frames changed (a dialog
 * open meanwhile) still puts it beside that frame; a frame no longer there
 * puts it at the end.
 */
export function insertFrame(frames: readonly SidebarFrame[], frame: SidebarFrame, slot: FrameSlot): SidebarFrame[] {
    const beside = slot.at === 'end' ? -1 : frames.findIndex(f => f.id === slot.id);
    const index = beside < 0 ? frames.length : slot.at === 'below' ? beside + 1 : beside;
    return [...frames.slice(0, index), frame, ...frames.slice(index)];
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
