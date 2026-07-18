import { TFile } from 'obsidian';
import type TaskViewerPlugin from '../main';
import type { Task, DisplayTask } from '../types';
import type { TaskReadService } from '../services/data/TaskReadService';
import type { TaskWriteService } from '../services/data/TaskWriteService';
import { toDisplayTask } from '../services/display/DisplayTaskConverter';
import { splitTasks } from '../services/display/TaskSplitter';
import { categorizeTasksByDate } from '../services/display/TaskDateCategorizer';
import { normalizeTask } from './TaskNormalizer';
import { TaskSorter } from '../services/sort/TaskSorter';
import type { SortState, SortProperty } from '../services/sort/SortTypes';
import { DateUtils } from '../utils/DateUtils';
import { parseDateTimeFlag } from '../cli/CliFilterBuilder';
import { parseDatePreset } from '../cli/CliDatePresetParser';
import { DateResolver } from '../services/filter/DateResolver';
import { buildFilterFromParams, assertValidFilterState } from './FilterParamsBuilder';
import { loadFilterFile } from './FilterFileLoader';
import {
    assertParams, renderParamTable,
    LIST_SCHEMA, TODAY_SCHEMA, GET_SCHEMA, CREATE_SCHEMA, UPDATE_SCHEMA,
    DELETE_SCHEMA, DUPLICATE_SCHEMA, CONVERT_SCHEMA,
    TASKS_FOR_DATE_RANGE_SCHEMA, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA,
    INSERT_CHILD_TASK_SCHEMA, CREATE_TV_FILE_SCHEMA,
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
    type ConvertParams,
    type ConvertResult,
    type TasksForDateRangeParams,
    type CategorizedTasksForDateRangeParams,
    type CategorizedTasksResult,
    type CategorizedTasksForDateRangeResult,
    type InsertChildTaskParams,
    type InsertChildTaskResult,
    type CreateTvFileParams,
    type CreateTvFileResult,
    type StartHourResult,
} from './TaskApiTypes';

const API_HELP_TEXT = `
Task Viewer API Reference
=========================

Access: app.plugins.plugins['obsidian-task-viewer'].api

Vocabulary
----------
  from / to        = query window (inclusive overlap). A task matches when
                     its span intersects [from, to].
  date             = single-day window, sugar for from=X to=X (list only)
  start / end / due = the task's own fields (create / update / createTvFile)

  Unknown parameter keys are errors (with a did-you-mean suggestion) —
  they are never silently ignored. Params documented as comma-separated
  strings (status, tag, color, type) also accept string arrays.

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

  convertToTvFile(params: ConvertParams): Promise<ConvertResult>
    Convert a tv-inline task to a tv-file (frontmatter) task.

    ConvertParams:
${renderParamTable(CONVERT_SCHEMA).replace(/^/gm, '    ')}

  tasksForDateRange(params: TasksForDateRangeParams): Promise<TaskListResult>
    List tasks whose visual span overlaps the window [from, to].
    Due-only tasks are included when due falls in the window.

    TasksForDateRangeParams:
${renderParamTable(TASKS_FOR_DATE_RANGE_SCHEMA).replace(/^/gm, '    ')}

  categorizedTasksForDateRange(params: CategorizedTasksForDateRangeParams): CategorizedTasksForDateRangeResult
    Get tasks in a date range, categorized into allDay/timed/dueOnly per date.
    allDay/timed membership follows the visual span; dueOnly the calendar due.

    CategorizedTasksForDateRangeParams:
${renderParamTable(CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA).replace(/^/gm, '    ')}

    Returns: Record<date, { allDay: NormalizedTask[], timed: NormalizedTask[], dueOnly: NormalizedTask[] }>

  insertChildTask(params: InsertChildTaskParams): Promise<InsertChildTaskResult>
    Insert a child task under a parent task.

    InsertChildTaskParams:
${renderParamTable(INSERT_CHILD_TASK_SCHEMA).replace(/^/gm, '    ')}

  createTvFile(params: CreateTvFileParams): Promise<CreateTvFileResult>
    Create a new tv-file (frontmatter) task from structured data.

    CreateTvFileParams:
${renderParamTable(CREATE_TV_FILE_SCHEMA).replace(/^/gm, '    ')}

    Returns: { newFile: string }

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
    tag        : includes, excludes, equals  (value: string[])
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
    kind       : includes, excludes          (value: string[] of 'inline' | 'file')
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
  api.get({ id: 'tv-inline:daily/2026-03-15.md:ln:5' });

  // Duplicate a task, shifting dates by 1 day
  await api.duplicate({ id: 'tv-inline:daily/2026-03-15.md:ln:5', dayOffset: 1 });

  // Duplicate a task 3 times (no date shift)
  await api.duplicate({ id: 'tv-inline:daily/2026-03-15.md:ln:5', count: 3 });

  // Convert a tv-inline task to a tv-file (frontmatter) task
  await api.convertToTvFile({ id: 'tv-inline:daily/2026-03-15.md:ln:5' });

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
  api.categorizedTasksForDateRange({ from: '2026-03-23', to: '2026-03-29' });

  // Insert a child task
  await api.insertChildTask({ parentId: 'tv-inline:daily/2026-03-15.md:ln:5', content: 'Sub-task' });

  // Create a tv-file (frontmatter) task
  await api.createTvFile({ content: 'Project task', start: '2026-03-20 10:00' });

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

export class TaskApi {
    private readService: TaskReadService;
    private writeService: TaskWriteService;

    constructor(private plugin: TaskViewerPlugin) {
        this.readService = plugin.getTaskReadService();
        this.writeService = plugin.getTaskWriteService();
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
            tasks: paged.map(normalizeTask),
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
            tasks: paged.map(normalizeTask),
        };
    }

    /**
     * Get a single task by ID.
     */
    get(params: GetParams): NormalizedTask {
        assertParams(params, GET_SCHEMA, 'get');

        const dt = this.readService.getDisplayTask(params.id);
        if (!dt) throw new TaskApiError(`Task not found: ${params.id}`);
        return normalizeTask(dt);
    }

    /**
     * Create a new inline task.
     */
    async create(params: CreateParams): Promise<MutationResult> {
        assertParams(params, CREATE_SCHEMA, 'create');

        const statusChar = params.status || ' ';
        if (statusChar.length !== 1) throw new TaskApiError(`status must be a single character, got: "${statusChar}"`);

        if (params.content.includes('\n')) throw new TaskApiError('content must not contain newlines');

        const file = this.plugin.app.vault.getAbstractFileByPath(params.file);
        if (!(file instanceof TFile)) throw new TaskApiError(`File not found: ${params.file}`);
        const content = params.content;

        let line = `- [${statusChar}] ${content}`;

        const hasDateFields = params.start || params.end || params.due;
        if (hasDateFields) {
            let dateBlock = '';
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

            line += ` ${dateBlock}`;
        }

        const insertedLine = await this.writeService.createTask(params.file, line, params.heading);

        const created = this.readService.getTaskByFileLine(params.file, insertedLine);
        if (!created) throw new TaskApiError('Task was created but could not be found after scan');

        return { task: normalizeTask(toDisplayTask(created, this.plugin.settings.startHour, (id) => this.readService.getTask(id))) };
    }

    /**
     * Update an existing task's fields.
     */
    async update(params: UpdateParams): Promise<MutationResult> {
        assertParams(params, UPDATE_SCHEMA, 'update');

        const task = this.readService.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);

        const updates: Partial<Task> = {};

        if (params.content !== undefined) {
            if (params.content.includes('\n')) throw new TaskApiError('content must not contain newlines');
            updates.content = params.content;
        }
        if (params.status !== undefined) {
            const sc = params.status === 'none' ? ' ' : params.status;
            if (sc.length !== 1) throw new TaskApiError(`status must be a single character or "none", got: "${params.status}"`);
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

        await this.writeService.updateTask(params.id, updates);

        const updated = this.readService.getTask(params.id);
        if (!updated) throw new TaskApiError(`Task not found after update: ${params.id}`);

        return { task: normalizeTask(toDisplayTask(updated, this.plugin.settings.startHour, (id) => this.readService.getTask(id))) };
    }

    /**
     * Delete a task.
     */
    async delete(params: DeleteParams): Promise<DeleteResult> {
        assertParams(params, DELETE_SCHEMA, 'delete');

        const task = this.readService.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);

        await this.writeService.deleteTask(params.id);
        return { deleted: params.id };
    }

    /**
     * Duplicate a task with optional date shifting.
     */
    async duplicate(params: DuplicateParams): Promise<DuplicateResult> {
        assertParams(params, DUPLICATE_SCHEMA, 'duplicate');
        const task = this.readService.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);
        if (params.dayOffset !== undefined) {
            if (typeof params.dayOffset !== 'number' || isNaN(params.dayOffset)) throw new TaskApiError('dayOffset must be a number');
        }
        if (params.count !== undefined) {
            if (typeof params.count !== 'number' || isNaN(params.count)) throw new TaskApiError('count must be a number');
            if (params.count < 1) throw new TaskApiError('count must be at least 1');
        }
        await this.writeService.duplicateTask(params.id, {
            dayOffset: params.dayOffset,
            count: params.count,
        });
        return { duplicated: params.id };
    }

    /**
     * Convert a tv-inline task to a tv-file (frontmatter) task.
     */
    async convertToTvFile(params: ConvertParams): Promise<ConvertResult> {
        assertParams(params, CONVERT_SCHEMA, 'convertToTvFile');
        const task = this.readService.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);
        const newPath = await this.writeService.convertToTvFile(params.id);
        return { convertedFrom: params.id, newFile: newPath };
    }

    /**
     * List tasks in a date range with optional filter, sort, and pagination.
     */
    async tasksForDateRange(params: TasksForDateRangeParams): Promise<TaskListResult> {
        assertParams(params, TASKS_FOR_DATE_RANGE_SCHEMA, 'tasksForDateRange');
        if (params.filter) assertValidFilterState(params.filter);
        const from = this.resolveWindowBound(params.from, 'from');
        const to = this.resolveWindowBound(params.to, 'to');
        let tasks = this.readService.getTasksForDateRange(from, to, params.filter, { includeInvalid: true });
        const sortState = buildSortState(params.sort);
        tasks = [...tasks];
        TaskSorter.sort(tasks, sortState);
        const { paged, total, resolvedLimit } = paginate(tasks, params);
        return {
            total,
            count: paged.length,
            truncated: paged.length < total,
            limit: resolvedLimit,
            tasks: paged.map(normalizeTask),
        };
    }

    /**
     * Get tasks in a date range, categorized into allDay/timed/dueOnly per date.
     */
    categorizedTasksForDateRange(params: CategorizedTasksForDateRangeParams): CategorizedTasksForDateRangeResult {
        assertParams(params, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA, 'categorizedTasksForDateRange');
        if (params.filter) assertValidFilterState(params.filter);
        const startHour = this.plugin.settings.startHour;
        const from = this.resolveWindowBound(params.from, 'from');
        const to = this.resolveWindowBound(params.to, 'to');
        const tasks = this.readService.getTasksForDateRange(from, to, params.filter, { includeInvalid: true });
        const split = splitTasks(tasks, { type: 'visual-date', startHour });
        const dates = DateUtils.getDateRange(from, to);
        const map = categorizeTasksByDate(split, dates, startHour);
        const result: CategorizedTasksForDateRangeResult = {};
        for (const [date, cats] of map) {
            result[date] = {
                allDay: cats.allDay.map(normalizeTask),
                timed: cats.timed.map(normalizeTask),
                dueOnly: cats.dueOnly.map(normalizeTask),
            };
        }
        return result;
    }

    /**
     * Insert a child task under a parent task.
     */
    async insertChildTask(params: InsertChildTaskParams): Promise<InsertChildTaskResult> {
        assertParams(params, INSERT_CHILD_TASK_SCHEMA, 'insertChildTask');
        if (params.content.includes('\n')) throw new TaskApiError('content must not contain newlines');
        const task = this.readService.getTask(params.parentId);
        if (!task) throw new TaskApiError(`Task not found: ${params.parentId}`);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.parentId} is read-only (parserId=${task.parserId})`);
        await this.writeService.insertChildTask(params.parentId, `- [ ] ${params.content}`);
        return { parentId: params.parentId };
    }

    /**
     * Create a new tv-file (frontmatter) task from structured data.
     */
    async createTvFile(params: CreateTvFileParams): Promise<CreateTvFileResult> {
        assertParams(params, CREATE_TV_FILE_SCHEMA, 'createTvFile');
        const statusChar = params.status ?? ' ';
        if (statusChar.length !== 1) throw new TaskApiError(`status must be a single character, got: "${statusChar}"`);
        const parsed = params.start ? parseDateTimeParam(params.start, 'start') : null;
        const parsedEnd = params.end ? parseDateTimeParam(params.end, 'end') : null;
        if (params.due) {
            const parsedDue = parseDateTimeParam(params.due, 'due');
            if (!parsedDue.date) throw new TaskApiError(`due must include a date, got: "${params.due}"`);
        }
        const newFile = await this.writeService.createTvFileFromData({
            content: params.content,
            statusChar,
            startDate: parsed?.date,
            startTime: parsed?.time,
            endDate: parsedEnd?.date || (parsedEnd?.time && parsed?.date ? parsed.date : undefined),
            endTime: parsedEnd?.time,
            due: params.due,
        });
        return { newFile };
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
     * Get the current startHour setting (visual day boundary).
     */
    getStartHour(): StartHourResult {
        return { startHour: this.readService.getStartHour() };
    }

    /**
     * Subscribe to task changes. Returns an unsubscribe function.
     */
    onChange(callback: (taskId?: string) => void): () => void {
        return this.readService.onChange(callback);
    }

    /**
     * Return API reference text.
     */
    help(): string {
        return API_HELP_TEXT;
    }
}
