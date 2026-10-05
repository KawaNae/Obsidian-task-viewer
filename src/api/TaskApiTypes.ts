import type { FilterState } from '../services/filter/FilterTypes';
import type { SortProperty, SortDirection } from '../services/sort/SortTypes';
import type { Issue } from '../utils/values/Read';
import { issueText } from '../utils/values/IssueText';

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

/** How an error's text names a parameter: by the API's key, or by the CLI's flag for it (`toCliName`). */
export type ParamNamer = (key: string) => string;

/**
 * An error the API answers with. One about a parameter carries the
 * parameter's key (`param`) and words its text through a namer, so a caller
 * that spells the parameters otherwise — the CLI's `parent-id` for
 * `parentId` — tells it in its own spelling (`textFor`).
 */
export class TaskApiError extends Error {
    /** The text in the API's spelling, without the pointer to api.help(). */
    readonly rawMessage: string;
    /** The key of the parameter the error is about, when it is about one. */
    readonly param?: string;
    private readonly text: (name: ParamNamer) => string;

    constructor(message: string);
    constructor(message: (name: ParamNamer) => string, param: string);
    constructor(message: string | ((name: ParamNamer) => string), param?: string) {
        const text = typeof message === 'string' ? () => message : message;
        const raw = text(key => key);
        super(`${raw} — See api.help() for reference`);
        this.name = 'TaskApiError';
        this.rawMessage = raw;
        this.text = text;
        if (param !== undefined) this.param = param;
    }

    /** The text with every parameter named by `name`. */
    textFor(name: ParamNamer): string {
        return this.text(name);
    }

    /** The error a parameter's value gives when read: `issue` told of `param`, `given` quoted. */
    static ofIssue(issue: Issue, param: string, given?: string): TaskApiError {
        return new TaskApiError(name => issueText(issue, name(param), given), param);
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
 * The simple per-field filters every query takes: each is a condition of
 * its own (`QueryShorthand`), taken together with the rest of the query.
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

/** A query's FilterStates, taken together with each other and the shorthand. */
export interface FilterSourceParams {
    filter?: FilterState;
    filterFile?: string;      // vault file path (.json FilterState or .md view template)
    list?: string;            // pinned list name (when filterFile is a .md template)
}

/**
 * The window shorthand: `date` is `period overlaps date`, `from` and `to`
 * `period overlaps { from, to }` (open on a side left out). Each is a date,
 * a date and a time, or a preset.
 */
export interface WindowParams {
    date?: string;
    from?: string;
    to?: string;
}

// ── list ──

export interface ListParams extends PaginationParams, SimpleFilterParams, FilterSourceParams, WindowParams {
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

