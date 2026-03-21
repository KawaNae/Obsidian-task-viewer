import { TFile } from 'obsidian';
import type TaskViewerPlugin from '../main';
import type { Task, DisplayTask, PinnedListDefinition } from '../types';
import { toDisplayTasks, toDisplayTask } from '../utils/DisplayTaskConverter';
import { normalizeTask } from './TaskNormalizer';
import { TaskFilterEngine } from '../services/filter/TaskFilterEngine';
import { TaskSorter } from '../services/sort/TaskSorter';
import { hasConditions } from '../services/filter/FilterTypes';
import type { FilterState } from '../services/filter/FilterTypes';
import type { SortState, SortProperty } from '../services/sort/SortTypes';
import { DateUtils } from '../utils/DateUtils';
import { ViewTemplateLoader } from '../services/template/ViewTemplateLoader';
import { HeadingInserter } from '../utils/HeadingInserter';
import { parseDateTimeFlag } from '../cli/CliFilterBuilder';
import { buildFilterFromParams } from './FilterParamsBuilder';
import { loadFilterFile } from './FilterFileLoader';
import {
    TaskApiError,
    type NormalizedTask,
    type ListParams,
    type TodayParams,
    type GetParams,
    type QueryParams,
    type CreateParams,
    type UpdateParams,
    type DeleteParams,
    type TaskListResult,
    type QueryResult,
    type QueryListEntry,
    type MutationResult,
    type DeleteResult,
    type ApiSortRule,
    type PaginationParams,
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
      type?: string | string[]     Task type (at-notation, frontmatter)
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

  query(params: QueryParams): Promise<QueryResult>
    Query tasks using a saved view template.

    QueryParams:
      template: string             Template basename (required)

    Returns: { template, viewType, lists: [{ name, count, tasks }] }

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
    taskType   : includes, excludes          (value: string[])
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
  api.get({ id: 'at-notation:daily/2026-03-15.md:ln:5' });
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
    constructor(private plugin: TaskViewerPlugin) {}

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

        const taskIndex = this.plugin.getTaskIndex();
        const { startHour } = this.plugin.settings;

        const displayTasks = toDisplayTasks(taskIndex.getTasks(), startHour);

        const filterState = buildFilterFromParams(p);

        let filtered: DisplayTask[];
        if (filterState) {
            const context = { taskLookup: (id: string) => taskIndex.getTask(id) };
            filtered = displayTasks.filter(t => TaskFilterEngine.evaluate(t, filterState, context));
        } else {
            filtered = displayTasks;
        }

        const sortState = buildSortState(p.sort);
        TaskSorter.sort(filtered, sortState);

        const paged = paginate(filtered, p);
        return { count: paged.length, tasks: paged.map(normalizeTask) };
    }

    /**
     * List tasks active today.
     */
    today(params?: TodayParams): TaskListResult {
        const p = params ?? {};
        const taskIndex = this.plugin.getTaskIndex();
        const { startHour } = this.plugin.settings;
        const today = DateUtils.getVisualDateOfNow(startHour);

        const displayTasks = toDisplayTasks(taskIndex.getTasks(), startHour);

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

        const task = this.plugin.getTaskIndex().getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);

        return normalizeTask(toDisplayTask(task, this.plugin.settings.startHour));
    }

    /**
     * Query tasks using a saved view template.
     */
    async query(params: QueryParams): Promise<QueryResult> {
        if (!params.template) throw new TaskApiError('Missing required parameter: template');

        const { settings } = this.plugin;
        if (!settings.viewTemplateFolder) {
            throw new TaskApiError('viewTemplateFolder is not configured in settings');
        }

        const loader = new ViewTemplateLoader(this.plugin.app);
        const summary = loader.findByBasename(settings.viewTemplateFolder, params.template);
        if (!summary) throw new TaskApiError(`Template not found: ${params.template}`);

        const template = await loader.loadFullTemplate(summary.filePath);
        if (!template) throw new TaskApiError(`Failed to load template: ${params.template}`);

        const taskIndex = this.plugin.getTaskIndex();
        const { startHour } = settings;
        const context = { taskLookup: (id: string) => taskIndex.getTask(id) };

        const allDisplayTasks = toDisplayTasks(taskIndex.getTasks(), startHour);

        let viewFiltered: DisplayTask[];
        if (template.filterState && hasConditions(template.filterState)) {
            viewFiltered = allDisplayTasks.filter(t =>
                TaskFilterEngine.evaluate(t, template.filterState!, context),
            );
        } else {
            viewFiltered = allDisplayTasks;
        }

        const pinnedLists: PinnedListDefinition[] = template.pinnedLists
            ?? (template.grid ? template.grid.flat() : []);

        if (pinnedLists.length === 0) {
            TaskSorter.sort(viewFiltered, undefined);
            return {
                template: template.name,
                viewType: template.viewType,
                lists: [{
                    name: template.name,
                    count: viewFiltered.length,
                    tasks: viewFiltered.map(normalizeTask),
                }],
            };
        }

        const lists: QueryListEntry[] = pinnedLists.map(list => {
            const source = list.applyViewFilter !== false ? viewFiltered : allDisplayTasks;
            const matched = source.filter(t =>
                TaskFilterEngine.evaluate(t, list.filterState, context),
            );
            TaskSorter.sort(matched, list.sortState);
            return { name: list.name, count: matched.length, tasks: matched.map(normalizeTask) };
        });

        return {
            template: template.name,
            viewType: template.viewType,
            lists,
        };
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

        if (params.heading) {
            await this.plugin.app.vault.process(file, (fileContent) =>
                HeadingInserter.insertUnderHeading(fileContent, line, params.heading!, 2),
            );
        } else {
            const repo = this.plugin.getTaskRepository();
            await repo.appendTaskToFile(params.file, line);
        }

        const taskIndex = this.plugin.getTaskIndex();
        await taskIndex.waitForScan(params.file);

        const tasks = taskIndex.getTasks().filter(
            t => t.file === params.file && t.content === content,
        );
        const created = tasks.length > 0
            ? tasks.reduce((a, b) => a.line > b.line ? a : b)
            : undefined;

        if (!created) throw new TaskApiError('Task was created but could not be found after scan');

        return { task: normalizeTask(toDisplayTask(created, this.plugin.settings.startHour)) };
    }

    /**
     * Update an existing task's fields.
     */
    async update(params: UpdateParams): Promise<MutationResult> {
        if (!params.id) throw new TaskApiError('Missing required parameter: id');

        const taskIndex = this.plugin.getTaskIndex();
        const task = taskIndex.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);

        const updates: Partial<Task> = {};

        if (params.content !== undefined) updates.content = params.content;
        if (params.status !== undefined) updates.statusChar = params.status;

        if (params.start !== undefined) {
            const parsed = parseDateTimeParam(params.start, 'start');
            if (parsed.date) updates.startDate = parsed.date;
            if (parsed.time) updates.startTime = parsed.time;
        }

        if (params.end !== undefined) {
            const parsed = parseDateTimeParam(params.end, 'end');
            if (parsed.date) updates.endDate = parsed.date;
            if (parsed.time) updates.endTime = parsed.time;
        }

        if (params.due !== undefined) {
            const parsed = parseDateTimeParam(params.due, 'due');
            updates.due = parsed.date;
        }

        await taskIndex.updateTask(params.id, updates);

        const updated = taskIndex.getTask(params.id);
        if (!updated) throw new TaskApiError(`Task not found after update: ${params.id}`);

        return { task: normalizeTask(toDisplayTask(updated, this.plugin.settings.startHour)) };
    }

    /**
     * Delete a task.
     */
    async delete(params: DeleteParams): Promise<DeleteResult> {
        if (!params.id) throw new TaskApiError('Missing required parameter: id');

        const taskIndex = this.plugin.getTaskIndex();
        const task = taskIndex.getTask(params.id);
        if (!task) throw new TaskApiError(`Task not found: ${params.id}`);

        await taskIndex.deleteTask(params.id);
        return { deleted: params.id };
    }

    /**
     * Return API reference text.
     */
    help(): string {
        return API_HELP_TEXT;
    }
}
