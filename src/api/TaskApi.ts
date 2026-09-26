import { TFile } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import type { Task, DisplayTask } from '../types';
import type { TaskReadService } from '../services/data/TaskReadService';
import type { TaskWriteService } from '../services/data/TaskWriteService';
import { toDisplayTask } from '../services/display/DisplayTaskConverter';
import { splitTasks } from '../services/display/TaskSplitter';
import { categorizeTasksByDate } from '../services/display/TaskDateCategorizer';
import { normalizeTask } from './TaskNormalizer';
import { apiIdOf, readApiId, type TaskLookup } from './TaskIds';
import { TaskSorter } from '../services/sort/TaskSorter';
import type { SortState, SortProperty } from '../services/sort/SortTypes';
import { DateUtils } from '../utils/DateUtils';
import { parseDateTimeFlag } from '../cli/CliFilterBuilder';
import { parseDatePreset } from '../cli/CliDatePresetParser';
import { DateResolver } from '../services/filter/DateResolver';
import { buildFilterFromParams, buildRangeFilterFromParams, assertValidFilterState } from './FilterParamsBuilder';
import type { FilterState } from '../services/filter/FilterTypes';
import { loadFilterFile } from './FilterFileLoader';
import { holdsLineBreak } from '../utils/LineBreak';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';
import { TaskParser } from '../services/parsing/TaskParser';
import { createTempTask } from '../services/data/createTempTask';
import {
    assertParams, renderParamTable,
    LIST_SCHEMA, TODAY_SCHEMA, GET_SCHEMA, CREATE_SCHEMA, UPDATE_SCHEMA,
    DELETE_SCHEMA, DUPLICATE_SCHEMA,
    TASKS_FOR_DATE_RANGE_SCHEMA, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA,
    INSERT_CHILD_TASK_SCHEMA,
} from './OperationSchemas';
import {
    TaskApiError,
    type NormalizedTask,
    type ListParams,
    type TodayParams,
    type GetParams,
    type CreateParams,
    type UpdateParams,
    type DeleteParams,
    type TaskListResult,
    type MutationResult,
    type DeleteResult,
    type ApiSortRule,
    type PaginationParams,
    type DuplicateParams,
    type DuplicateResult,
    type TasksForDateRangeParams,
    type CategorizedTasksForDateRangeParams,
    type CategorizedTasksResult,
    type CategorizedTasksForDateRangeResult,
    type InsertChildTaskParams,
    type InsertChildTaskResult,
    type StartHourResult,
} from './TaskApiTypes';

/**
 * Whether a value holds a line break. Every value here becomes part of one
 * line of a note; a break would split it in two, and the write layer refuses
 * such a line whole (`LineBreakInLine`). Refused here instead, where the
 * caller can be told which parameter it was.
 *
 * A line break is what ends a line of a note (`holdsLineBreak`): CR and LF.
 * U+2028 and U+2029 are not — Obsidian keeps them inside the line, and so
 * does every reader here — so a value may hold them.
 */
function hasLineBreak(value: string): boolean {
    return holdsLineBreak(value);
}

export const API_HELP_TEXT = `
Task Viewer API Reference
=========================

Access: app.plugins.plugins['obsidian-task-viewer'].api

Vocabulary
----------
  from / to        = query window (inclusive overlap). A task matches when
                     its span intersects [from, to].
  date             = single-day window, sugar for from=X to=X (list only)
  start / end / due = the task's own fields (create / update)

  Unknown parameter keys are errors (with a did-you-mean suggestion) —
  they are never silently ignored. Params documented as comma-separated
  strings (status, tag, color, type) also accept string arrays.

Task IDs
--------
  id, parentId and childIds take one of two shapes:
    path#^id  for a line whose ^id no other line of the file carries.
              It lasts across edits from outside and reloads.
    a name    for any other line: a receipt for one reading of the file.
              It lasts until the file changes outside the plugin or the
              plugin reloads, even when the file comes back to what it
              was. Do not store it; list the tasks again. Give a task a
              ^id to keep its ID.
  update returns the task as written: a name comes back as its new ID.

Methods
-------

  list(params?: ListParams): Promise<TaskListResult>
    List tasks with optional filters, sort, and pagination.

    ListParams:
${renderParamTable(LIST_SCHEMA).replace(/^/gm, '    ')}

    Returns: { total: number, count: number, truncated: boolean, limit: number | null, tasks: NormalizedTask[] }

  today(params?: TodayParams): TaskListResult
    List tasks active today (visual-date aware).

    TodayParams:
${renderParamTable(TODAY_SCHEMA).replace(/^/gm, '    ')}

  get(params: GetParams): NormalizedTask
    Get a single task by ID.

    GetParams:
${renderParamTable(GET_SCHEMA).replace(/^/gm, '    ')}

  create(params: CreateParams): Promise<MutationResult>
    Create a new inline task.

    CreateParams:
${renderParamTable(CREATE_SCHEMA).replace(/^/gm, '    ')}

  update(params: UpdateParams): Promise<MutationResult>
    Update an existing task.

    UpdateParams:
${renderParamTable(UPDATE_SCHEMA).replace(/^/gm, '    ')}

  delete(params: DeleteParams): Promise<DeleteResult>
    Delete a task.

    DeleteParams:
${renderParamTable(DELETE_SCHEMA).replace(/^/gm, '    ')}

  help(): string
    Show this reference.

  duplicate(params: DuplicateParams): Promise<DuplicateResult>
    Duplicate a task with optional date shifting.

    DuplicateParams:
${renderParamTable(DUPLICATE_SCHEMA).replace(/^/gm, '    ')}

  tasksForDateRange(params: TasksForDateRangeParams): Promise<TaskListResult>
    List tasks whose visual span overlaps the window [from, to].
    Due-only tasks are included when due falls in the window.

    TasksForDateRangeParams:
${renderParamTable(TASKS_FOR_DATE_RANGE_SCHEMA).replace(/^/gm, '    ')}

  categorizedTasksForDateRange(params: CategorizedTasksForDateRangeParams): Promise<CategorizedTasksForDateRangeResult>
    Get tasks in a date range, categorized into allDay/timed/dueOnly per date.
    allDay/timed membership follows the visual span; dueOnly the calendar due.

    CategorizedTasksForDateRangeParams:
${renderParamTable(CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA).replace(/^/gm, '    ')}

    Returns: Record<date, { allDay: NormalizedTask[], timed: NormalizedTask[], dueOnly: NormalizedTask[] }>

  insertChildTask(params: InsertChildTaskParams): Promise<InsertChildTaskResult>
    Insert a child task under a parent task.

    InsertChildTaskParams:
${renderParamTable(INSERT_CHILD_TASK_SCHEMA).replace(/^/gm, '    ')}

  getStartHour(): StartHourResult
    Get the current startHour setting (visual day boundary).

    Returns: { startHour: number }

  onChange(callback): () => void
    Subscribe to task changes. Returns unsubscribe function.

Sort
----
  ApiSortRule: { property: string, direction?: 'asc' | 'desc' }
  Properties: content, due, startDate, endDate, file, status, tag

Date Formats
------------
  Absolute:  YYYY-MM-DD (e.g. 2026-03-15)
  Datetime:  YYYY-MM-DD HH:mm (e.g. 2026-03-15 14:00)
  Time only: HH:mm (e.g. 14:00)
  Presets:   today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear,
             next7days, next30days

FilterState (JSON format)
-------------------------
  { logic: 'and', filters: [...] }

  Condition:
    { property: string, operator: string, value?: ..., target?: 'parent' }

  Target:
    Add target: 'parent' to evaluate the condition against the task's
    parent (and ancestors). Example: tasks whose parent has tag "project":
    { property: 'tag', operator: 'includes', value: ['project'], target: 'parent' }

  Properties & Operators:
    file       : includes, excludes          (value: string[])
    tag        : includes, excludes, equals, only  (value: string[])
                                             (only = tags are exactly this set, nothing more)
    status     : includes, excludes          (value: string[])
    content    : contains, notContains       (value: string)
    startDate  : isSet, isNotSet, equals, before, after, onOrBefore, onOrAfter
                                             (value: 'YYYY-MM-DD' or { preset: '...' })
    endDate    : (same as startDate)
    due        : (same as startDate)
    color      : includes, excludes          (value: string[])
    linestyle  : includes, excludes          (value: string[])
    length     : lessThan, lessThanOrEqual, greaterThan, greaterThanOrEqual, equals, isSet, isNotSet
                                             (value: number, unit?: 'hours'|'minutes')
    anyDate    : isSet, isNotSet             (no value needed; isSet = any of start/end/due set)
    notation   : includes, excludes          (value: string[] of 'taskviewer' | 'tasks' | 'dayplanner')
    parent     : isSet, isNotSet             (no value needed)
    children   : isSet, isNotSet             (no value needed)
    property   : isSet, isNotSet, equals, contains, notContains
                                             (value: string, key: string)

NormalizedTask Fields
---------------------
  id, file, line, content, status, startDate, startTime, endDate, endTime,
  due, tags, parserId, parentId, childIds, color, linestyle,
  effectiveStartDate, effectiveStartTime, effectiveEndDate, effectiveEndTime,
  durationMinutes, properties

Examples
--------
  const api = app.plugins.plugins['obsidian-task-viewer'].api;

  // List all tasks in a file
  await api.list({ file: 'daily/2026-03-15' });

  // Filter by tag (exact match) using FilterState
  await api.list({
    filter: {
      logic: 'and',
      filters: [
        { property: 'tag', operator: 'equals', value: ['work'] }
      ]
    }
  });

  // Use a filter file
  await api.list({ filterFile: 'filters/exact-tag.json' });

  // Use a view template with pinned list
  await api.list({ filterFile: 'templates/work.md', list: 'urgent' });

  // Today's tasks, sorted by start date
  api.today({ sort: [{ property: 'startDate', direction: 'asc' }] });

  // Get a specific task
  api.get({ id: 'daily/2026-03-15.md#^review' });

  // Duplicate a task, shifting dates by 1 day
  await api.duplicate({ id: 'daily/2026-03-15.md#^review', dayOffset: 1 });

  // Duplicate a task 3 times (no date shift)
  await api.duplicate({ id: 'daily/2026-03-15.md#^review', count: 3 });

  // List tasks in a date range (window bounds accept presets too)
  await api.tasksForDateRange({ from: '2026-03-01', to: '2026-03-31' });
  await api.tasksForDateRange({ from: 'today', to: 'today' });

  // List tasks in a date range with sort
  await api.tasksForDateRange({
    from: '2026-03-01',
    to: '2026-03-31',
    sort: [{ property: 'startDate', direction: 'asc' }],
  });

  // Get categorized tasks for a date range (or single date)
  await api.categorizedTasksForDateRange({ from: '2026-03-23', to: '2026-03-29' });

  // Insert a child task
  await api.insertChildTask({ parentId: 'daily/2026-03-15.md#^review', content: 'Sub-task' });

  // Get visual day boundary setting
  api.getStartHour();

  // Subscribe to task changes
  const unsubscribe = api.onChange((taskId) => {
    console.log('Task changed:', taskId);
  });
  // Later: unsubscribe();
`.trim();

// ── Internal helpers ──

const VALID_SORT_PROPERTIES = {
    content: true, due: true, startDate: true, endDate: true,
    file: true, status: true, tag: true,
} as const satisfies Record<SortProperty, true>;

function buildSortState(rules?: ApiSortRule[]): SortState | undefined {
    if (!rules || rules.length === 0) return undefined;
    for (const r of rules) {
        if (!(r.property in VALID_SORT_PROPERTIES)) {
            throw new TaskApiError(
                `Unknown sort property: ${r.property}. Available: ${Object.keys(VALID_SORT_PROPERTIES).join(', ')}`,
            );
        }
        if (r.direction !== undefined && r.direction !== 'asc' && r.direction !== 'desc') {
            throw new TaskApiError(`Invalid sort direction: ${r.direction}. Use asc or desc`);
        }
    }
    return {
        rules: rules.map((r, i) => ({
            id: `s-api-${i}`,
            property: r.property as SortProperty,
            direction: r.direction ?? 'asc',
        })),
    };
}

interface PaginateResult {
    paged: DisplayTask[];
    total: number;
    resolvedLimit: number | null;
}

function paginate(tasks: DisplayTask[], params: PaginationParams): PaginateResult {
    const total = tasks.length;
    const rawLimit = params.limit ?? 100;
    if (typeof rawLimit !== 'number' || isNaN(rawLimit)) throw new TaskApiError('limit must be a number');
    if (rawLimit < 0) throw new TaskApiError('limit must be non-negative');
    if (rawLimit === 0) return { paged: [], total, resolvedLimit: 0 };
    if (!isFinite(rawLimit)) return { paged: tasks, total, resolvedLimit: null };
    return { paged: tasks.slice(0, rawLimit), total, resolvedLimit: rawLimit };
}

function parseDateTimeParam(value: string, fieldName: string): { date: string; time?: string } {
    const result = parseDateTimeFlag(value);
    if (!result) {
        throw new TaskApiError(
            `Invalid date format for ${fieldName}: ${value}. Use YYYY-MM-DD, YYYY-MM-DD HH:mm, or HH:mm`,
        );
    }
    return result;
}

// ── Public API ──

/**
 * Hands out the public API object.
 *
 * Declared here rather than in `PluginContext` on purpose: `TaskApi` takes the
 * plugin itself, so a context that named `TaskApi` would import the module that
 * imports it back — the same cycle the context exists to close, moved one file
 * along. A module that needs both asks for `PluginContext & ApiHost`.
 */
export interface ApiHost {
    readonly api: TaskApi;
}

export class TaskApi {
    private readService: TaskReadService;
    private writeService: TaskWriteService;

    constructor(private plugin: PluginContext) {
        this.readService = plugin.getTaskReadService();
        this.writeService = plugin.getTaskWriteService();
    }

    private readonly lookup: TaskLookup = (name) => this.readService.getTask(name);

    /** A task as the API hands it out, its IDs included (`apiIdOf`). */
    private readonly out = (task: DisplayTask): NormalizedTask => normalizeTask(task, this.lookup);

    /**
     * The index's copy of the row an ID the API took names (`readApiId`),
     * or a `TaskApiError` saying why there is none. Every ID the API takes
     * comes here.
     *
     * An anchored ID finds its row in the file's last reading; a name finds
     * its row only in the reading that gave it, or across writes of ours
     * since. Either way the write goes by the copy's name, through the check
     * every write passes: a file changed since its last reading refuses it.
     */
    private rowOf(id: string): Task {
        const read = readApiId(id);
        if (read.kind === 'anchor') {
            const task = this.readService.getTaskByAnchor(read.file, read.anchor);
            if (!task) throw new TaskApiError(`Task not found: ${id} (no line of ${read.file} carries ^${read.anchor} alone)`);
            return task;
        }
        const task = this.readService.getTask(read.name);
        if (!task) throw new TaskApiError(`Task not found: ${id} (an ID without a ^id lasts only until its file changes or the plugin reloads; list the tasks again)`);
        return task;
    }

    /**
     * List tasks with optional filters, sort, and pagination.
     */
    async list(params?: ListParams): Promise<TaskListResult> {
        assertParams(params ?? {}, LIST_SCHEMA, 'list');
        const p = { ...(params ?? {}) };

        if (p.list && !p.filterFile) {
            throw new TaskApiError('list requires filterFile (a .md view template)');
        }

        // Resolve filterFile → filter (async file read)
        if (p.filterFile) {
            const result = await loadFilterFile(this.plugin.app, p.filterFile, p.list);
            if (typeof result === 'string') throw new TaskApiError(result);
            p.filter = result;
        }

        const readService = this.readService;

        const filterState = buildFilterFromParams(p);
        const sortState = buildSortState(p.sort);

        let filtered: DisplayTask[];
        if (filterState) {
            filtered = readService.getFilteredTasks(filterState, sortState, { includeInvalid: true });
        } else {
            filtered = [...readService.getAllDisplayTasks()];
            TaskSorter.sort(filtered, sortState);
        }

        const { paged, total, resolvedLimit } = paginate(filtered, p);
        return {
            total,
            count: paged.length,
            truncated: paged.length < total,
            limit: resolvedLimit,
            tasks: paged.map(this.out),
        };
    }

    /**
     * List tasks active today.
     */
    today(params?: TodayParams): TaskListResult {
        assertParams(params ?? {}, TODAY_SCHEMA, 'today');
        const p = params ?? {};
        const readService = this.readService;
        const { startHour } = this.plugin.settings;
        const today = DateUtils.getVisualDateOfNow(startHour);

        const displayTasks = readService.getAllDisplayTasks();

        let filtered = displayTasks.filter(t => {
            const start = t.effectiveStartDate;
            const end = t.effectiveEndDate;
            const duePart = DateUtils.dueDatePart(t.effectiveDue);
            if (!start && !duePart) return false;
            if (!start && duePart) return duePart === today;
            if (start && start > today) return false;
            if (end && end < today) return false;
            if (!end && start && start < today) return false;
            return true;
        });

        if (p.leaf) {
            filtered = filtered.filter(t => t.childIds.length === 0);
        }

        const sortState = buildSortState(p.sort);
        TaskSorter.sort(filtered, sortState);

        const { paged, total, resolvedLimit } = paginate(filtered, p);
        return {
            total,
            count: paged.length,
            truncated: paged.length < total,
            limit: resolvedLimit,
            tasks: paged.map(this.out),
        };
    }

    /**
     * Get a single task by ID.
     */
    get(params: GetParams): NormalizedTask {
        assertParams(params, GET_SCHEMA, 'get');

        const dt = this.readService.getDisplayTask(this.rowOf(params.id).id);
        if (!dt) throw new TaskApiError(`Task not found: ${params.id}`);
        return this.out(dt);
    }

    /**
     * Create a new inline task.
     */
    async create(params: CreateParams): Promise<MutationResult> {
        assertParams(params, CREATE_SCHEMA, 'create');

        const statusChar = params.status || ' ';
        if (!TaskLineClassifier.isStatusChar(statusChar)) throw new TaskApiError(`status must be a single character a checkbox can hold (not a line break, U+2028 or U+2029), got: ${JSON.stringify(statusChar)}`);

        if (hasLineBreak(params.content)) throw new TaskApiError('content must not contain line breaks (\\r or \\n)');

        if (params.heading !== undefined && hasLineBreak(params.heading)) throw new TaskApiError('heading must not contain line breaks (\\r or \\n)');

        const file = this.plugin.app.vault.getAbstractFileByPath(params.file);
        if (!(file instanceof TFile)) throw new TaskApiError(`File not found: ${params.file}`);
        const content = params.content;

        let dateBlock = '';
        const hasDateFields = params.start || params.end || params.due;
        if (hasDateFields) {
            if (params.start) {
                const parsed = parseDateTimeParam(params.start, 'start');
                dateBlock = `@${parsed.date}`;
                if (parsed.time) dateBlock += parsed.date ? `T${parsed.time}` : parsed.time;
            } else {
                dateBlock = '@';
            }

            if (params.end) {
                const parsed = parseDateTimeParam(params.end, 'end');
                dateBlock += `>${parsed.date}`;
                if (parsed.time) dateBlock += parsed.date ? `T${parsed.time}` : parsed.time;
            }

            if (params.due) {
                if (!params.end) dateBlock += '>';
                const parsed = parseDateTimeParam(params.due, 'due');
                dateBlock += `>${parsed.date}`;
            }

        }
        const line = TaskLineClassifier.formatPrefix(statusChar) + TaskLineClassifier.joinContent(content, dateBlock);

        const insertedLine = await this.writeService.createTask(params.file, line, params.heading);
        if (insertedLine === null) throw new TaskApiError(`Task could not be written to: ${params.file}`);

        const created = this.readService.getTaskByFileLine(params.file, insertedLine);
        if (!created) throw new TaskApiError('Task was created but could not be found after scan');

        return { task: this.out(toDisplayTask(created, this.plugin.settings.startHour, this.lookup)) };
    }

    /**
     * Update an existing task's fields.
     */
    async update(params: UpdateParams): Promise<MutationResult> {
        assertParams(params, UPDATE_SCHEMA, 'update');

        const task = this.rowOf(params.id);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);

        const updates: Partial<Task> = {};

        if (params.content !== undefined) {
            if (hasLineBreak(params.content)) throw new TaskApiError('content must not contain line breaks (\\r or \\n)');
            updates.content = params.content;
        }
        if (params.status !== undefined) {
            const sc = params.status === 'none' ? ' ' : params.status;
            if (!TaskLineClassifier.isStatusChar(sc)) throw new TaskApiError(`status must be a single character a checkbox can hold (not a line break, U+2028 or U+2029), or "none", got: ${JSON.stringify(params.status)}`);
            updates.statusChar = sc;
        }

        if (params.start !== undefined) {
            if (params.start === 'none') {
                updates.startDate = undefined;
                updates.startTime = undefined;
            } else {
                const parsed = parseDateTimeParam(params.start, 'start');
                if (parsed.date) updates.startDate = parsed.date;
                if (parsed.time) updates.startTime = parsed.time;
            }
        }

        if (params.end !== undefined) {
            if (params.end === 'none') {
                updates.endDate = undefined;
                updates.endTime = undefined;
            } else {
                const parsed = parseDateTimeParam(params.end, 'end');
                if (parsed.date) updates.endDate = parsed.date;
                if (parsed.time) updates.endTime = parsed.time;
            }
        }

        if (params.due !== undefined) {
            if (params.due === 'none') {
                updates.due = undefined;
            } else {
                const parsed = parseDateTimeParam(params.due, 'due');
                if (!parsed.date) throw new TaskApiError(`due must include a date, got: "${params.due}"`);
                updates.due = parsed.date;
            }
        }

        // A write that could not be placed leaves the index reverted to the
        // former values, so reading the task back would describe a change that
        // never reached the file and report it as a success.
        const written = await this.writeService.updateTask(task.id, updates);
        if (!written) throw new TaskApiError(`Task could not be written: ${params.id}`);

        // The row's name now: our write moved its file on, and the name is
        // followed across it (`TaskIndex.getTask`). An unanchored row's ID
        // changes with it.
        const updated = this.readService.getTask(task.id);
        if (!updated) throw new TaskApiError(`Task not found after update: ${params.id}`);

        return { task: this.out(toDisplayTask(updated, this.plugin.settings.startHour, this.lookup)) };
    }

    /**
     * Delete a task.
     */
    async delete(params: DeleteParams): Promise<DeleteResult> {
        assertParams(params, DELETE_SCHEMA, 'delete');

        const task = this.rowOf(params.id);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);

        const removed = await this.writeService.deleteTask(task.id);
        if (!removed) throw new TaskApiError(`Task could not be deleted: ${params.id}`);
        return { deleted: params.id };
    }

    /**
     * Duplicate a task.
     *
     * `dayOffset` picks the axis the copies run along and `count` says how
     * many there are. Without an offset they run along the clock, as next:
     * the first starts where the task ends — an hour on when no end was
     * written, at the written or inherited end when it has one — keeps its
     * length, and each further copy starts where the one before it ends.
     * They are written after the task and its children. With an offset they
     * run along the calendar, one per day from `dayOffset`, written before
     * the task with the latest first.
     *
     * A task that holds no time of day — a bare date, a span of whole days,
     * a line with no dates — has no slot to move out of, so its copies are
     * the line again, written out unchanged. Child lines travel verbatim on
     * either axis, dates and times included, and a due date never shifts.
     */
    async duplicate(params: DuplicateParams): Promise<DuplicateResult> {
        assertParams(params, DUPLICATE_SCHEMA, 'duplicate');
        const task = this.rowOf(params.id);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);
        if (params.dayOffset !== undefined) {
            if (typeof params.dayOffset !== 'number' || isNaN(params.dayOffset)) throw new TaskApiError('dayOffset must be a number');
        }
        if (params.count !== undefined) {
            if (typeof params.count !== 'number' || isNaN(params.count)) throw new TaskApiError('count must be a number');
            if (!Number.isInteger(params.count)) throw new TaskApiError('count must be a whole number');
            if (params.count < 1) throw new TaskApiError('count must be at least 1');
        }
        const written = await this.writeService.duplicateTask(task.id, {
            dayOffset: params.dayOffset,
            count: params.count,
        });
        if (!written) throw new TaskApiError(`Task could not be duplicated: ${params.id}`);
        return { duplicated: params.id };
    }

    /**
     * List tasks in a date range with optional filter, sort, and pagination.
     */
    async tasksForDateRange(params: TasksForDateRangeParams): Promise<TaskListResult> {
        assertParams(params, TASKS_FOR_DATE_RANGE_SCHEMA, 'tasksForDateRange');
        const filterState = await this.resolveRangeFilter(params);
        const from = this.resolveWindowBound(params.from, 'from');
        const to = this.resolveWindowBound(params.to, 'to');
        let tasks = this.readService.getTasksForDateRange(from, to, filterState ?? undefined, { includeInvalid: true });
        const sortState = buildSortState(params.sort);
        tasks = [...tasks];
        TaskSorter.sort(tasks, sortState);
        const { paged, total, resolvedLimit } = paginate(tasks, params);
        return {
            total,
            count: paged.length,
            truncated: paged.length < total,
            limit: resolvedLimit,
            tasks: paged.map(this.out),
        };
    }

    /**
     * Get tasks in a date range, categorized into allDay/timed/dueOnly per date.
     */
    async categorizedTasksForDateRange(params: CategorizedTasksForDateRangeParams): Promise<CategorizedTasksForDateRangeResult> {
        assertParams(params, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA, 'categorizedTasksForDateRange');
        const filterState = await this.resolveRangeFilter(params);
        const startHour = this.plugin.settings.startHour;
        const from = this.resolveWindowBound(params.from, 'from');
        const to = this.resolveWindowBound(params.to, 'to');
        const tasks = this.readService.getTasksForDateRange(from, to, filterState ?? undefined, { includeInvalid: true });
        const split = splitTasks(tasks, { type: 'visual-date', startHour });
        const dates = DateUtils.getDateRange(from, to);
        const map = categorizeTasksByDate(split, dates, startHour);
        const result: CategorizedTasksForDateRangeResult = {};
        for (const [date, cats] of map) {
            result[date] = {
                allDay: cats.allDay.map(this.out),
                timed: cats.timed.map(this.out),
                dueOnly: cats.dueOnly.map(this.out),
            };
        }
        return result;
    }

    /**
     * Insert a child task under a parent task.
     */
    async insertChildTask(params: InsertChildTaskParams): Promise<InsertChildTaskResult> {
        assertParams(params, INSERT_CHILD_TASK_SCHEMA, 'insertChildTask');
        if (hasLineBreak(params.content)) throw new TaskApiError('content must not contain line breaks (\\r or \\n)');
        const task = this.rowOf(params.parentId);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.parentId} is read-only (parserId=${task.parserId})`);
        const written = await this.writeService.insertLine(task.id, TaskParser.format(createTempTask({ id: 'api-child', content: params.content })), 'firstChild');
        if (!written) throw new TaskApiError(`Child task could not be written under: ${params.parentId}`);
        return { parentId: params.parentId };
    }

    /**
     * Resolve a window-bound value (YYYY-MM-DD or date preset) to a concrete
     * date: `from` takes the start of the preset's window, `to` its end, so
     * `from=thisweek to=thisweek` covers the whole week.
     */
    private resolveWindowBound(value: string, side: 'from' | 'to'): string {
        const parsed = parseDatePreset(value);
        if (!parsed) {
            throw new TaskApiError(
                `Invalid date value for ${side}: ${value}. Use YYYY-MM-DD or a preset (today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear, nextNdays)`,
            );
        }
        const { weekStartDay, startHour } = this.plugin.settings;
        const window = DateResolver.resolve(parsed, weekStartDay, startHour);
        return side === 'from' ? window.start : window.end;
    }

    /**
     * Resolve filterFile/list → filter, then build a FilterState from the
     * simple fields. Same override order as `list` (params.filter wins,
     * then filterFile — `list` picks one pinned list out of a .md template —
     * then the simple per-field flags), but never a date-window condition:
     * from/to on these params is the range's own window bound, already
     * applied separately via getTasksForDateRange, so buildRangeFilterFromParams
     * has no date/from/to field to read in the first place.
     */
    private async resolveRangeFilter(
        params: TasksForDateRangeParams | CategorizedTasksForDateRangeParams,
    ): Promise<FilterState | null> {
        const p = { ...params };
        if (p.list && !p.filterFile) {
            throw new TaskApiError("'list' requires 'filterFile' (a .md view template)");
        }
        if (p.filterFile) {
            const result = await loadFilterFile(this.plugin.app, p.filterFile, p.list);
            if (typeof result === 'string') throw new TaskApiError(result);
            p.filter = result;
        }
        return buildRangeFilterFromParams(p);
    }

    /**
     * Get the current startHour setting (visual day boundary).
     */
    getStartHour(): StartHourResult {
        return { startHour: this.readService.getStartHour() };
    }

    /**
     * Subscribe to task changes. Returns an unsubscribe function.
     */
    onChange(callback: (taskId?: string) => void): () => void {
        // The ID given is the API's (`apiIdOf`), like every other it hands out.
        return this.readService.onChange(taskId => callback(taskId === undefined ? undefined : apiIdOf(taskId, this.lookup)));
    }

    /**
     * Return API reference text.
     */
    help(): string {
        return API_HELP_TEXT;
    }
}
