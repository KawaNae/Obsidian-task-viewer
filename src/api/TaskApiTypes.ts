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
    parserId: string;
    parentId: string | null;
    childIds: string[];
    color: string | null;
    linestyle: string | null;
    effectiveStartDate: string | null;
    effectiveStartTime: string | null;
    effectiveEndDate: string | null;
    effectiveEndTime: string | null;
    durationMinutes: number | null;
}

// ── Error ──

export class TaskApiError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TaskApiError';
    }
}

// ── Sort shorthand ──

export interface ApiSortRule {
    property: SortProperty;
    direction?: SortDirection;  // default: 'asc'
}

// ── Pagination ──

export interface PaginationParams {
    limit?: number;    // default: 100
    offset?: number;   // default: 0
}

// ── list ──

export interface ListParams extends PaginationParams {
    file?: string;
    status?: string[];
    tag?: string[];
    content?: string;
    date?: string;            // YYYY-MM-DD or preset
    from?: string;
    to?: string;
    due?: string;
    leaf?: boolean;
    filter?: FilterState;     // overrides simple filter fields above
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

// ── query (template) ──

export interface QueryParams {
    template: string;
    date?: string;
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
    count: number;
    tasks: NormalizedTask[];
}

export interface QueryListEntry {
    name: string;
    count: number;
    tasks: NormalizedTask[];
}

export interface QueryResult {
    template: string;
    viewType: string;
    lists: QueryListEntry[];
}

export interface MutationResult {
    task: NormalizedTask;
}

export interface DeleteResult {
    deleted: string;
}
