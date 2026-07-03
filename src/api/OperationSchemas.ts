import { TaskApiError } from './TaskApiTypes';
import type {
    ListParams, TodayParams, GetParams, CreateParams, UpdateParams, DeleteParams,
    DuplicateParams, ConvertParams, TasksForDateRangeParams,
    CategorizedTasksForDateRangeParams, InsertChildTaskParams, CreateTvFileParams,
} from './TaskApiTypes';

/**
 * Single source of truth for the CLI/API parameter *surface* (keys, required
 * flags, CLI exposure). Consumed by:
 *   - assertParams() — strict unknown-key / required validation on the API
 *   - the CLI registrar — flag declarations and unknown-flag validation
 *   - help output — generated flag tables
 *
 * Deliberately NOT a conversion or help framework: handlers keep their
 * hand-written CliData → params parsing, and the prose parts of help /
 * docs stay hand-written. Only keys, required-ness, and one-line
 * descriptions live here.
 *
 * The `satisfies ParamMap<XxxParams>` bindings tie each schema to its API
 * param type at compile time: a key added to or removed from the type
 * without updating the schema (or vice versa) is a compile error.
 */

export interface ParamSpec {
    required?: true;
    /** 'hidden' = API-only parameter (not exposed as a CLI flag). */
    cli?: 'hidden';
    /** CLI help placeholder, e.g. '<date|preset>'. Omit for boolean/hidden params. */
    value?: string;
    /** Boolean flag: no value on the CLI, boolean in the API. */
    boolean?: true;
    description: string;
}

type ParamMap<P> = { [K in keyof Required<P>]: ParamSpec };

// ── Operation schemas ──

export const LIST_SCHEMA = {
    file:     { value: '<path>',          description: 'Filter by file path' },
    status:   { value: '<chars>',         description: 'Filter by status char(s), comma-separated' },
    tag:      { value: '<tags>',          description: 'Filter by tag(s), comma-separated' },
    content:  { value: '<text>',          description: 'Filter by content (contains)' },
    date:     { value: '<date|preset>',   description: 'Tasks active on date (spans and single-day)' },
    from:     { value: '<date|preset>',   description: 'Filter: startDate >= value' },
    to:       { value: '<date|preset>',   description: 'Filter: endDate <= value' },
    due:      { value: '<date|preset>',   description: 'Due date equals' },
    leaf:     { boolean: true,            description: 'Only leaf tasks (no children)' },
    property: { value: '<key:value>',     description: 'Filter by custom property (e.g. "優先度:高")' },
    color:    { value: '<colors>',        description: 'Filter by color(s), comma-separated' },
    type:     { value: '<types>',         description: 'Filter by task notation (taskviewer, tasks, dayplanner)' },
    root:     { boolean: true,            description: 'Only root tasks (no parent)' },
    filter:   { cli: 'hidden',            description: 'FilterState object (API only). Overrides simple filter params' },
    filterFile: { value: '<path>',        description: 'FilterState JSON (.json) or view template (.md). Overrides simple filter flags' },
    list:     { value: '<name>',          description: 'Pinned list name (for .md templates with pinnedLists)' },
    sort:     { value: '<prop[:dir],..>', description: 'Sort (e.g. startDate:asc,due:desc)' },
    limit:    { value: '<number>',        description: 'Max results (default: 100)' },
    offset:   { value: '<number>',        description: 'Skip first N results' },
} as const satisfies ParamMap<ListParams>;

export const TODAY_SCHEMA = {
    leaf:   { boolean: true,            description: 'Only leaf tasks (no children)' },
    sort:   { value: '<prop[:dir],..>', description: 'Sort' },
    limit:  { value: '<number>',        description: 'Max results' },
    offset: { value: '<number>',        description: 'Skip first N' },
} as const satisfies ParamMap<TodayParams>;

export const GET_SCHEMA = {
    id: { value: '<taskId>', description: 'Task ID', required: true },
} as const satisfies ParamMap<GetParams>;

export const CREATE_SCHEMA = {
    file:    { value: '<path>',          description: 'Target file path', required: true },
    content: { value: '<text>',          description: 'Task content', required: true },
    start:   { value: '<date|datetime>', description: 'Start date (YYYY-MM-DD or YYYY-MM-DD HH:mm)' },
    end:     { value: '<date|datetime>', description: 'End date/datetime' },
    due:     { value: '<YYYY-MM-DD>',    description: 'Due date' },
    status:  { value: '<char>',          description: 'Status character (default: space)' },
    heading: { value: '<heading>',       description: 'Insert under heading (default: end of file)' },
} as const satisfies ParamMap<CreateParams>;

export const UPDATE_SCHEMA = {
    id:      { value: '<taskId>',             description: 'Task ID', required: true },
    content: { value: '<text>',               description: 'New content' },
    start:   { value: '<date|datetime|none>', description: 'New start date/datetime ("none" to clear)' },
    end:     { value: '<date|datetime|none>', description: 'New end date/datetime ("none" to clear)' },
    due:     { value: '<YYYY-MM-DD|none>',    description: 'New due date ("none" to clear)' },
    status:  { value: '<char|none>',          description: 'New status character ("none" to uncheck)' },
} as const satisfies ParamMap<UpdateParams>;

export const DELETE_SCHEMA = {
    id: { value: '<taskId>', description: 'Task ID', required: true },
} as const satisfies ParamMap<DeleteParams>;

export const DUPLICATE_SCHEMA = {
    id:        { value: '<taskId>', description: 'Task ID', required: true },
    dayOffset: { value: '<number>', description: 'Days to shift dates (default: 0)' },
    count:     { value: '<number>', description: 'Number of copies (default: 1)' },
} as const satisfies ParamMap<DuplicateParams>;

export const CONVERT_SCHEMA = {
    id: { value: '<taskId>', description: 'Task ID', required: true },
} as const satisfies ParamMap<ConvertParams>;

export const TASKS_FOR_DATE_RANGE_SCHEMA = {
    from:   { value: '<date|preset>',   description: 'Query window start (inclusive)', required: true },
    to:     { value: '<date|preset>',   description: 'Query window end (inclusive)', required: true },
    filter: { cli: 'hidden',            description: 'FilterState object (API only)' },
    sort:   { value: '<prop[:dir],..>', description: 'Sort (e.g. startDate:asc,due:desc)' },
    limit:  { value: '<number>',        description: 'Max results' },
    offset: { value: '<number>',        description: 'Skip first N' },
} as const satisfies ParamMap<TasksForDateRangeParams>;

export const CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA = {
    from:   { value: '<date|preset>', description: 'Query window start (inclusive)', required: true },
    to:     { value: '<date|preset>', description: 'Query window end (inclusive)', required: true },
    filter: { cli: 'hidden',          description: 'FilterState object (API only)' },
} as const satisfies ParamMap<CategorizedTasksForDateRangeParams>;

export const INSERT_CHILD_TASK_SCHEMA = {
    parentId: { value: '<taskId>', description: 'Parent task ID', required: true },
    content:  { value: '<text>',   description: 'Child task content', required: true },
} as const satisfies ParamMap<InsertChildTaskParams>;

export const CREATE_TV_FILE_SCHEMA = {
    content: { value: '<text>',          description: 'Task content', required: true },
    start:   { value: '<date|datetime>', description: 'Start date/datetime' },
    end:     { value: '<date|datetime>', description: 'End date/datetime' },
    due:     { value: '<YYYY-MM-DD>',    description: 'Due date' },
    status:  { value: '<char>',          description: 'Status character (default: space)' },
} as const satisfies ParamMap<CreateTvFileParams>;

// ── CLI derivation ──

/**
 * CLI-only output-shaping flags, shared by every command that prints tasks.
 * These have no API-param counterpart (the API returns structured data).
 */
export const CLI_OUTPUT_SCHEMA: Record<string, ParamSpec> = {
    format:       { value: 'json|tsv|jsonl',   description: 'Output format (default: json)' },
    outputFields: { value: '<key,key,...>',    description: 'Output fields (default: id only). e.g. content,status,startDate' },
};

/** Rule, not data: CLI flag name = kebab-case of the API key. */
export function toCliName(apiKey: string): string {
    return apiKey.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
}

export interface CliFlagDecl {
    value?: string;
    description: string;
    required?: boolean;
}

/**
 * Derive the CLI flag declarations for a command from its operation schema.
 * Hidden (API-only) params are skipped; boolean params become value-less
 * flags; multi-word keys become kebab-case.
 */
export function toCliFlags(
    schema: Record<string, ParamSpec>,
    opts: { output?: boolean } = {},
): Record<string, CliFlagDecl> {
    const flags: Record<string, CliFlagDecl> = {};
    const add = (source: Record<string, ParamSpec>) => {
        for (const [key, spec] of Object.entries(source)) {
            if (spec.cli === 'hidden') continue;
            const decl: CliFlagDecl = { description: spec.description };
            if (!spec.boolean && spec.value) decl.value = spec.value;
            if (spec.required) decl.required = true;
            flags[toCliName(key)] = decl;
        }
    };
    add(schema);
    if (opts.output) add(CLI_OUTPUT_SCHEMA);
    return flags;
}

// ── Validation ──

/**
 * Suggest the closest known key for a typo, or null when nothing is close.
 * Damerau-Levenshtein distance <= 2 (<= 1 for keys of length <= 3, to avoid
 * false positives on short names like 'to'/'due'), with prefix match as a
 * tie-breaking fallback.
 */
export function suggestKey(unknown: string, candidates: readonly string[]): string | null {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
        const maxDist = Math.min(unknown.length, c.length) <= 3 ? 1 : 2;
        const d = damerauLevenshtein(unknown.toLowerCase(), c.toLowerCase());
        if (d <= maxDist && d < bestDist) {
            best = c;
            bestDist = d;
        }
    }
    if (best && bestDist <= 1) return best;
    // Prefer a prefix match over a weak (distance-2) edit match: 'cont' should
    // suggest 'content', not 'root'.
    const prefix = candidates.find(c => c.toLowerCase().startsWith(unknown.toLowerCase()) && unknown.length >= 3);
    return prefix ?? best;
}

function damerauLevenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 3;  // early out: cannot be within threshold
    const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[m][n];
}

/**
 * Strict parameter validation for API methods: reject unknown keys (with a
 * did-you-mean suggestion) and enforce required keys. Value parsing stays in
 * each method — this guards only the parameter surface.
 */
export function assertParams(
    params: object,
    schema: Record<string, ParamSpec>,
    operation: string,
): void {
    const known = Object.keys(schema);
    const values = params as Record<string, unknown>;
    for (const key of Object.keys(values)) {
        if (!(key in schema)) {
            const suggestion = suggestKey(key, known);
            throw new TaskApiError(
                `Unknown parameter for ${operation}: ${key}.` +
                (suggestion ? ` Did you mean: ${suggestion}?` : ` Available: ${known.join(', ')}`),
            );
        }
    }
    for (const key of known) {
        const spec = schema[key];
        if (spec.required) {
            const v = values[key];
            if (v === undefined || v === null || v === '') {
                throw new TaskApiError(`Missing required parameter: ${key}`);
            }
        }
    }
}
