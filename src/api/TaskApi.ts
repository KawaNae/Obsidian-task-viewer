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
import type { FilterState } from '../services/filter/FilterTypes';
import type { SortState, SortProperty } from '../services/sort/SortTypes';
import { DateUtils } from '../utils/DateUtils';
import { parseDateTimeFlag } from '../cli/CliFilterBuilder';
import { buildFilterFromParams } from './FilterParamsBuilder';
import { loadFilterFile } from './FilterFileLoader';
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
    type CreateFrontmatterParams,
    type CreateFrontmatterResult,
    type StartHourResult,
} from './TaskApiTypes';

const API_HELP_TEXT = `
Task Viewer API Reference
=========================

Access: app.plugins.plugins['obsidian-task-viewer'].api

Methods
-------

  list(params?: ListParams): Promise<TaskListResult>
    List tasks with optional filters, sort, and pagination.

    ListParams:
      file?: string               File path (.md auto-appended)
      status?: string | string[]   Status char(s) (e.g. 'x' or ['x', '-'])
      tag?: string | string[]      Tag(s) (# auto-stripped, hierarchy match)
      content?: string             Content partial match
      date?: string                Tasks active on date (YYYY-MM-DD or preset)
      from?: string                startDate >= value
      to?: string                  endDate <= value
      due?: string                 Due date equals
      leaf?: boolean               Only leaf tasks (no children)
      root?: boolean               Only root tasks (no parent)
      property?: string            Custom property ("key:value")
      color?: string | string[]    Card color(s)
      type?: string | string[]     Task notation (taskviewer, tasks, dayplanner)
      filter?: FilterState         FilterState object (overrides simple fields)
      filterFile?: string          Vault file path (.json or .md template)
      list?: string                Pinned list name (for .md templates)
      sort?: ApiSortRule[]         Sort rules [{property, direction?}]
      limit?: number               Max results (default: 100)
      offset?: number              Skip first N results

    Returns: { count: number, tasks: NormalizedTask[] }

  today(params?: TodayParams): TaskListResult
    List tasks active today (visual-date aware).

    TodayParams:
      leaf?: boolean               Only leaf tasks
      sort?: ApiSortRule[]         Sort rules
      limit?: number               Max results (default: 100)
      offset?: number              Skip first N results

  get(params: GetParams): NormalizedTask
    Get a single task by ID.

    GetParams:
      id: string                   Task ID (required)

  create(params: CreateParams): Promise<MutationResult>
    Create a new inline task.

    CreateParams:
      file: string                 Target file path (required)
      content: string              Task content (required)
      start?: string               Start date (YYYY-MM-DD, YYYY-MM-DD HH:mm, HH:mm)
      end?: string                 End date/datetime
      due?: string                 Due date (YYYY-MM-DD)
      status?: string              Status character (default: ' ')
      heading?: string             Insert under heading (default: end of file)

  update(params: UpdateParams): Promise<MutationResult>
    Update an existing task.

    UpdateParams:
      id: string                   Task ID (required)
      content?: string             New content
      start?: string               New start date/datetime
      end?: string                 New end date/datetime
      due?: string                 New due date
      status?: string              New status character

  delete(params: DeleteParams): Promise<DeleteResult>
    Delete a task.

    DeleteParams:
      id: string                   Task ID (required)

  help(): string
    Show this reference.

  duplicate(params: DuplicateParams): Promise<DuplicateResult>
    Duplicate a task with optional date shifting.

    DuplicateParams:
      id: string                   Task ID (required)
      dayOffset?: number           Days to shift dates (default: 0)
      count?: number               Number of copies (default: 1)

  convertToFrontmatter(params: ConvertParams): Promise<ConvertResult>
    Convert an inline task to a frontmatter task file.

    ConvertParams:
      id: string                   Task ID (required)

  tasksForDateRange(params: TasksForDateRangeParams): Promise<TaskListResult>
    List tasks in a date range.

    TasksForDateRangeParams:
      start: string                Start date YYYY-MM-DD (required)
      end: string                  End date YYYY-MM-DD (required)
      filter?: FilterState         FilterState object
      sort?: ApiSortRule[]         Sort rules
      limit?: number               Max results (default: 100)
      offset?: number              Skip first N results

  categorizedTasksForDateRange(params: CategorizedTasksForDateRangeParams): CategorizedTasksForDateRangeResult
    Get tasks in a date range, categorized into allDay/timed/dueOnly per date.

    CategorizedTasksForDateRangeParams:
      start: string                Start date YYYY-MM-DD (required)
      end: string                  End date YYYY-MM-DD (required)
      filter?: FilterState         FilterState object

    Returns: Record<date, { allDay: NormalizedTask[], timed: NormalizedTask[], dueOnly: NormalizedTask[] }>

  insertChildTask(params: InsertChildTaskParams): Promise<InsertChildTaskResult>
    Insert a child task under a parent task.

    InsertChildTaskParams:
      parentId: string             Parent task ID (required)
      content: string              Child task content (required)

  createFrontmatterTask(params: CreateFrontmatterParams): Promise<CreateFrontmatterResult>
    Create a new frontmatter task file from structured data.

    CreateFrontmatterParams:
      content: string              Task content (required)
      start?: string               Start date/datetime
      end?: string                 End date/datetime
      due?: string                 Due date (YYYY-MM-DD)
      status?: string              Status character (default: ' ')

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

  // Convert an inline task to a frontmatter task file
  await api.convertToFrontmatter({ id: 'tv-inline:daily/2026-03-15.md:ln:5' });

  // List tasks in a date range
  await api.tasksForDateRange({ start: '2026-03-01', end: '2026-03-31' });

  // List tasks in a date range with sort
  await api.tasksForDateRange({
    start: '2026-03-01',
    end: '2026-03-31',
    sort: [{ property: 'startDate', direction: 'asc' }],
  });

  // Get categorized tasks for a date range (or single date)
  api.categorizedTasksForDateRange({ start: '2026-03-23', end: '2026-03-29' });

  // Insert a child task
  await api.insertChildTask({ parentId: 'tv-inline:daily/2026-03-15.md:ln:5', content: 'Sub-task' });

  // Create a frontmatter task
  await api.createFrontmatterTask({ content: 'Project task', start: '2026-03-20 10:00' });

  // Get visual day boundary setting
  api.getStartHour();

  // Subscribe to task changes
  const unsubscribe = api.onChange((taskId) => {
    console.log('Task changed:', taskId);
  });
  // Later: unsubscribe();
`.trim();

// ── Internal helpers ──

const VALID_SORT_PROPERTIES: Set<string> = new Set<string>([
    'content', 'due', 'startDate', 'endDate', 'file', 'status', 'tag',
]);

function buildSortState(rules?: ApiSortRule[]): SortState | undefined {
    if (!rules || rules.length === 0) return undefined;
    for (const r of rules) {
        if (!VALID_SORT_PROPERTIES.has(r.property)) {
            throw new TaskApiError(
                `Unknown sort property: ${r.property}. Available: ${[...VALID_SORT_PROPERTIES].join(', ')}`,
            );
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

function paginate(tasks: DisplayTask[], params: PaginationParams): DisplayTask[] {
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    if (limit === 0) return [];
    return tasks.slice(offset, offset + limit);
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
        const p = { ...(params ?? {}) };

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
            filtered = readService.getFilteredTasks(filterState, sortState);
        } else {
            filtered = [...readService.getAllDisplayTasks()];
            TaskSorter.sort(filtered, sortState);
        }

        const paged = paginate(filtered, p);
        return { count: paged.length, tasks: paged.map(normalizeTask) };
    }

    /**
     * List tasks active today.
     */
    today(params?: TodayParams): TaskListResult {
        const p = params ?? {};
        const readService = this.readService;
        const { startHour } = this.plugin.settings;
        const today = DateUtils.getVisualDateOfNow(startHour);

        const displayTasks = readService.getAllDisplayTasks();

        let filtered = displayTasks.filter(t => {
            const start = t.effectiveStartDate;
            const end = t.effectiveEndDate;
            if (!start && !t.due) return false;
            if (!start && t.due) return t.due === today;
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

        const paged = paginate(filtered, p);
        return { count: paged.length, tasks: paged.map(normalizeTask) };
    }

    /**
     * Get a single task by ID.
     */
    get(params: GetParams): NormalizedTask {
        if (!params.id) throw new TaskApiError('Missing required parameter: id');

        const dt = this.readService.getDisplayTask(params.id);
        if (!dt) throw new TaskApiError(`Task not found: ${params.id}`);
        return normalizeTask(dt);
    }

    /**
     * Create a new inline task.
     */
    async create(params: CreateParams): Promise<MutationResult> {
        if (!params.file) throw new TaskApiError('Missing required parameter: file');
        if (!params.content) throw new TaskApiError('Missing required parameter: content');

        const file = this.plugin.app.vault.getAbstractFileByPath(params.file);
        if (!(file instanceof TFile)) throw new TaskApiError(`File not found: ${params.file}`);

        const statusChar = params.status || ' ';
        const content = params.content;

        let line = `- [${statusChar}] ${content}`;

        const hasDateFields = params.start || params.end || params.due;
        if (hasDateFields) {
            let dateBlock = '';
            if (params.start) {
                const parsed = parseDateTimeParam(params.start, 'start');
                dateBlock = `@${parsed.date}`;
                if (parsed.time) dateBlock += `T${parsed.time}`;
            } else {
                dateBlock = '@';
            }

            if (params.end) {
                const parsed = parseDateTimeParam(params.end, 'end');
                dateBlock += `>${parsed.date}`;
                if (parsed.time) dateBlock += `T${parsed.time}`;
            }

            if (params.due) {
                if (!params.end) dateBlock += '>';
                const parsed = parseDateTimeParam(params.due, 'due');
                dateBlock += `>${parsed.date}`;
            }

            line += ` ${dateBlock}`;
        }

        await this.writeService.createTask(params.file, line, params.heading);

        const tasks = this.readService.getTasks().filter(
            t => t.file === params.file && t.content === content,
        );
        const created = tasks.length > 0
            ? tasks.reduce((a, b) => a.line > b.line ? a : b)
            : undefined;

        if (!created) throw new TaskApiError('Task was created but could not be found after scan');

        return { task: normalizeTask(toDisplayTask(created, this.plugin.settings.startHour, (id) => this.readService.getTask(id))) };
    }

    /**
     * Update an existing task's fields.
     */
    async update(params: UpdateParams): Promise<MutationResult> {
        if (!params.id) throw new TaskApiError('Missing required parameter: id');

        const task = this.readService.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);

        const updates: Partial<Task> = {};

        if (params.content !== undefined) updates.content = params.content;
        if (params.status !== undefined) {
            updates.statusChar = params.status === 'none' ? ' ' : params.status;
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
        if (!params.id) throw new TaskApiError('Missing required parameter: id');

        const task = this.readService.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);

        await this.writeService.deleteTask(params.id);
        return { deleted: params.id };
    }

    /**
     * Duplicate a task with optional date shifting.
     */
    async duplicate(params: DuplicateParams): Promise<DuplicateResult> {
        if (!params.id) throw new TaskApiError('Missing required parameter: id');
        const task = this.readService.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);
        await this.writeService.duplicateTask(params.id, {
            dayOffset: params.dayOffset,
            count: params.count,
        });
        return { duplicated: params.id };
    }

    /**
     * Convert an inline task to a frontmatter task file.
     */
    async convertToFrontmatter(params: ConvertParams): Promise<ConvertResult> {
        if (!params.id) throw new TaskApiError('Missing required parameter: id');
        const task = this.readService.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);
        const newPath = await this.writeService.convertToTvFile(params.id);
        return { convertedFrom: params.id, newFile: newPath };
    }

    /**
     * List tasks in a date range with optional filter, sort, and pagination.
     */
    async tasksForDateRange(params: TasksForDateRangeParams): Promise<TaskListResult> {
        if (!params.start) throw new TaskApiError('Missing required parameter: start');
        if (!params.end) throw new TaskApiError('Missing required parameter: end');
        let tasks = this.readService.getTasksForDateRange(params.start, params.end, params.filter);
        const sortState = buildSortState(params.sort);
        if (sortState) {
            tasks = [...tasks];
            TaskSorter.sort(tasks, sortState);
        }
        const paged = paginate(tasks, params);
        return { count: paged.length, tasks: paged.map(normalizeTask) };
    }

    /**
     * Get tasks in a date range, categorized into allDay/timed/dueOnly per date.
     */
    categorizedTasksForDateRange(params: CategorizedTasksForDateRangeParams): CategorizedTasksForDateRangeResult {
        if (!params.start) throw new TaskApiError('Missing required parameter: start');
        if (!params.end) throw new TaskApiError('Missing required parameter: end');
        const startHour = this.plugin.settings.startHour;
        const tasks = this.readService.getTasksForDateRange(params.start, params.end, params.filter);
        const split = splitTasks(tasks, { type: 'visual-date', startHour });
        const dates = DateUtils.getDateRange(params.start, params.end);
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
        if (!params.parentId) throw new TaskApiError('Missing required parameter: parentId');
        if (!params.content) throw new TaskApiError('Missing required parameter: content');
        const task = this.readService.getTask(params.parentId);
        if (!task) throw new TaskApiError(`Task not found: ${params.parentId}`);
        await this.writeService.insertChildTask(params.parentId, `- [ ] ${params.content}`);
        return { parentId: params.parentId };
    }

    /**
     * Create a new frontmatter task file from structured data.
     */
    async createFrontmatterTask(params: CreateFrontmatterParams): Promise<CreateFrontmatterResult> {
        if (!params.content) throw new TaskApiError('Missing required parameter: content');
        const parsed = params.start ? parseDateTimeFlag(params.start) : null;
        const parsedEnd = params.end ? parseDateTimeFlag(params.end) : null;
        const newFile = await this.writeService.createFrontmatterTaskFromData({
            content: params.content,
            statusChar: params.status ?? ' ',
            startDate: parsed?.date,
            startTime: parsed?.time,
            endDate: parsedEnd?.date || (parsedEnd?.time && parsed?.date ? parsed.date : undefined),
            endTime: parsedEnd?.time,
            due: params.due,
        });
        return { newFile };
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
