import type { App } from 'obsidian';

/**
 * Plain config describing what to expand on the cloned export container before
 * capture. Replaces the prior `ExportStrategy` class hierarchy — the previous
 * interface had 3 methods (expandScrollAreas / simulateScrollPosition /
 * getScrollAreaSelectors) of which 2 were dropped together with the
 * "visible-area" export mode. With only one operation left, a plain spec object
 * is enough and avoids dead abstraction.
 */
export interface ExportTargetSpec {
    /** Scroll areas to grow to their scrollHeight inside the clone. */
    scrollAreas: string[];
    /** Selector for ancestors whose overflow constraints should be lifted. */
    overflowParents: string;
    /** Optional per-view extra expansion (e.g. Kanban cell minHeight reset). */
    extraExpand?: (container: HTMLElement, restoreFns: (() => void)[]) => void;
}

export interface ViewExportOptions {
    app: App;
    container: HTMLElement;
    filename: string;
    folder: string;
}

/** The date range a view is currently drawing, as it itself reports it. */
export interface RenderedDateRange {
    anchor: string;
    from: string;
    to: string;
}

/**
 * Views that can report their own currently-drawn date range implement this.
 * Duck-typed (see `getExportedDateRange` in ExportService) rather than a
 * shared base class, since Timeline/Calendar/Schedule/Kanban don't otherwise
 * share one.
 */
export interface ExportableDateRangeView {
    getExportedDateRange(): RenderedDateRange | null;
}
