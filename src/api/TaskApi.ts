import { TFile } from 'obsidian';
import type TaskViewerPlugin from '../main';
import type { Task, DisplayTask, PinnedListDefinition } from '../types';
import { toDisplayTasks, toDisplayTask } from '../utils/DisplayTaskConverter';
import { normalizeTask } from './TaskNormalizer';
import { TaskFilterEngine } from '../services/filter/TaskFilterEngine';
import { TaskSorter } from '../services/sort/TaskSorter';
import { hasConditions } from '../services/filter/FilterTypes';
import type { FilterState, FilterConditionNode, FilterGroupNode } from '../services/filter/FilterTypes';
import type { SortState, SortProperty } from '../services/sort/SortTypes';
import { DateUtils } from '../utils/DateUtils';
import { ViewTemplateLoader } from '../services/template/ViewTemplateLoader';
import { HeadingInserter } from '../utils/HeadingInserter';
import { parseDatePreset } from '../cli/CliDatePresetParser';
import { parseDateTimeFlag } from '../cli/CliFilterBuilder';
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

// ── Internal helpers ──

function generateId(prefix: string): string {
    return `${prefix}-api-${Math.random().toString(36).slice(2, 7)}`;
}

function condition(
    property: FilterConditionNode['property'],
    operator: FilterConditionNode['operator'],
    value: FilterConditionNode['value'],
): FilterConditionNode {
    return { type: 'condition', id: generateId('f'), property, operator, value };
}

function normalizeStringArray(value: string | string[] | undefined, stripHash = false): string[] {
    if (!value) return [];
    const arr = typeof value === 'string' ? value.split(',') : value;
    return arr.map(s => { let v = s.trim(); if (stripHash) v = v.replace(/^#/, ''); return v; }).filter(Boolean);
}

function buildFilterFromParams(params: ListParams): FilterState | null {
    if (params.filter) return params.filter;

    const conditions: FilterConditionNode[] = [];

    if (params.file) {
        const file = params.file.endsWith('.md') ? params.file : params.file + '.md';
        conditions.push(condition('file', 'includes', {
            type: 'stringSet', values: [file],
        }));
    }

    const statusArr = normalizeStringArray(params.status);
    if (statusArr.length > 0) {
        conditions.push(condition('status', 'includes', {
            type: 'stringSet', values: statusArr,
        }));
    }

    const tagArr = normalizeStringArray(params.tag, true);
    if (tagArr.length > 0) {
        conditions.push(condition('tag', 'includes', {
            type: 'stringSet', values: tagArr,
        }));
    }

    if (params.content) {
        conditions.push(condition('content', 'contains', {
            type: 'string', value: params.content,
        }));
    }

    if (params.date) {
        const dateValue = parseDatePreset(params.date);
        if (!dateValue) throw new TaskApiError(`Invalid date value: ${params.date}. Use YYYY-MM-DD or a preset (today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear, next7days)`);
        conditions.push(condition('startDate', 'onOrBefore', { type: 'date', value: dateValue }));
        conditions.push(condition('endDate', 'onOrAfter', { type: 'date', value: dateValue }));
    } else {
        if (params.from) {
            const fromValue = parseDatePreset(params.from);
            if (!fromValue) throw new TaskApiError(`Invalid date value for from: ${params.from}. Use YYYY-MM-DD or a preset`);
            conditions.push(condition('startDate', 'onOrAfter', { type: 'date', value: fromValue }));
        }
        if (params.to) {
            const toValue = parseDatePreset(params.to);
            if (!toValue) throw new TaskApiError(`Invalid date value for to: ${params.to}. Use YYYY-MM-DD or a preset`);
            conditions.push(condition('endDate', 'onOrBefore', { type: 'date', value: toValue }));
        }
    }

    if (params.due) {
        const dueValue = parseDatePreset(params.due);
        if (!dueValue) throw new TaskApiError(`Invalid date value for due: ${params.due}. Use YYYY-MM-DD or a preset`);
        conditions.push(condition('due', 'equals', { type: 'date', value: dueValue }));
    }

    if (params.leaf) {
        conditions.push(condition('children', 'isNotSet', { type: 'boolean', value: true }));
    }

    if (params.property) {
        const colonIdx = params.property.indexOf(':');
        if (colonIdx < 1) throw new TaskApiError('Invalid property filter format. Use "key:value"');
        const key = params.property.substring(0, colonIdx).trim();
        const value = params.property.substring(colonIdx + 1).trim();
        conditions.push(condition('property', 'contains', { type: 'property', key, value }));
    }

    if (conditions.length === 0) return null;

    const root: FilterGroupNode = {
        type: 'group',
        id: generateId('g'),
        children: conditions,
        logic: 'and',
    };
    return { root };
}

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
        rules: rules.map(r => ({
            id: generateId('s'),
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
    list(params?: ListParams): TaskListResult {
        const p = params ?? {};
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
}
