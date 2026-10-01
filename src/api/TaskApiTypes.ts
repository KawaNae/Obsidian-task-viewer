import type { FilterState } from '../services/filter/FilterTypes';
import type { SortProperty, SortDirection } from '../services/sort/SortTypes';

// ── Normalized task (public API surface) ──

export interface NormalizedTask {
    id: string;
    file: string;
    line: number;
    content: string;
    status: string;
    startDate: string | null;
    startTime: string | null;
    endDate: string | null;
    endTime: string | null;
    due: string | null;
    tags: string[];
    /**
     * Parser identity. Current values: 'tv-inline', 'tasks-plugin', 'day-planner'.
     *
     * Renamed from legacy values: 'at-notation' → 'tv-inline', 'plain' → folded
     * into 'tv-inline'. 'tv-file' (formerly 'frontmatter') is retired: frontmatter
     * makes no task. Update external scripts accordingly.
     */
    parserId: string;
    parentId: string | null;
    childIds: string[];
    color: string | null;
    linestyle: string | null;
    effectiveStartDate: string | null;
    effectiveStartTime: string | null;
    effectiveEndDate: string | null;
    effectiveEndTime: string | null;
    effectiveDue: string | null;
    durationMinutes: number | null;
    properties: Record<string, unknown>;
    flow: string | null;
}

// ── Error ──

export class TaskApiError extends Error {
    readonly rawMessage: string;
    constructor(message: string) {
        super(`${message} — See api.help() for reference`);
        this.name = 'TaskApiError';
        this.rawMessage = message;
    }
}

// ── Sort shorthand ──

export interface ApiSortRule {
    property: SortProperty;
    direction?: SortDirection;  // default: 'asc'
}

// ── Pagination ──

export interface PaginationParams {
    limit?: number;    // default: 100, 0=count-only, Infinity=unlimited
}

// ── Filters ──

/**
 * The simple per-field filters `list` and the date-range family share. No
 * `date`/`from`/`to`: those are `list`'s own query window, and the range
 * operations have their own required window — a range operation never also
 * applies a `list`-style window condition on top of its own, or a task would
 * have to satisfy two different date judgments to appear at all.
 */
export interface SimpleFilterParams {
    file?: string;
    status?: string | string[];
    tag?: string | string[];
    content?: string;
    due?: string;             // YYYY-MM-DD or preset
    leaf?: boolean;
    property?: string;        // "key:value" — filter by custom property
    color?: string | string[];   // card color filter
    type?: string | string[];    // task notation (taskviewer, tasks, dayplanner)
    root?: boolean;              // root tasks only (no parent)
}

/** Where a query's filter comes from instead of the simple fields. */
export interface FilterSourceParams {
    filter?: FilterState;     // overrides the simple filter fields
    filterFile?: string;      // vault file path (.json FilterState or .md view template); overrides `filter`
    list?: string;            // pinned list name (when filterFile is a .md template)
}

// ── list ──

export interface ListParams extends PaginationParams, SimpleFilterParams, FilterSourceParams {
    date?: string;            // YYYY-MM-DD or preset
    from?: string;
    to?: string;
    sort?: ApiSortRule[];
}

// ── today ──

export interface TodayParams extends PaginationParams {
    leaf?: boolean;
    sort?: ApiSortRule[];
}

// ── get ──

export interface GetParams {
    id: string;
}

// ── create ──

export interface CreateParams {
    file: string;
    content: string;
    start?: string;     // YYYY-MM-DD, YYYY-MM-DD HH:mm, HH:mm
    end?: string;
    due?: string;       // YYYY-MM-DD
    status?: string;    // single char, default: ' '
    heading?: string;   // Insert under this heading (e.g. "Tasks"). Fallback: end of file
}

// ── update ──

export interface UpdateParams {
    id: string;
    content?: string;
    start?: string;
    end?: string;
    due?: string;
    status?: string;
}

// ── delete ──

export interface DeleteParams {
    id: string;
}

// ── Result types ──

export interface TaskListResult {
    total: number;
    count: number;
    truncated: boolean;
    limit: number | null;
    tasks: NormalizedTask[];
}

export interface MutationResult {
    task: NormalizedTask;
}

export interface DeleteResult {
    deleted: string;
}

export interface DuplicateParams {
    id: string;
    dayOffset?: number;
    count?: number;
}

export interface DuplicateResult {
    duplicated: string;
}

export interface TasksForDateRangeParams extends PaginationParams, SimpleFilterParams, FilterSourceParams {
    /** Query window start (inclusive). YYYY-MM-DD or a date preset. */
    from: string;
    /** Query window end (inclusive). YYYY-MM-DD or a date preset. */
    to: string;
    sort?: ApiSortRule[];
}

// ── categorizedTasksForDateRange ──

export interface CategorizedTasksForDateRangeParams extends SimpleFilterParams, FilterSourceParams {
    /** Query window start (inclusive). YYYY-MM-DD or a date preset. */
    from: string;
    /** Query window end (inclusive). YYYY-MM-DD or a date preset. */
    to: string;
}

export interface CategorizedTasksResult {
    allDay: NormalizedTask[];
    timed: NormalizedTask[];
    dueOnly: NormalizedTask[];
}

export type CategorizedTasksForDateRangeResult = Record<string, CategorizedTasksResult>;

// ── insertChildTask ──

export interface InsertChildTaskParams {
    parentId: string;
    content: string;
}

export interface InsertChildTaskResult {
    parentId: string;
}


// ── startHour ──

export interface StartHourResult {
    startHour: number;
}

