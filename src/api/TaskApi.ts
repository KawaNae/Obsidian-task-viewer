import { TFile } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import type { Task, DisplayTask } from '../types';
import type { TaskReadService } from '../services/data/TaskReadService';
import type { IndexReads } from '../services/core/TaskIndex';
import type { Operations } from '../services/operations/Operations';
import { toDisplayTask } from '../services/display/DisplayTaskConverter';
import { splitTasks } from '../services/display/TaskSplitter';
import { categorizeTasksByDate } from '../services/display/TaskDateCategorizer';
import { normalizeTask } from './TaskNormalizer';
import { API_REFERENCE } from './Reference';
import { apiIdOf, readApiId, type TaskLookup } from './TaskIds';
import type { SortState } from '../services/sort/SortTypes';
import { createEmptyFilterState } from '../services/filter/FilterTypes';
import { SortSerializer, sortIssueText } from '../services/sort/SortSerializer';
import { DateUtils } from '../utils/DateUtils';
import { endDayOf, ofValue, visualDayOf } from '../utils/DayWindow';
import { resolveQuery } from './FilterParamsBuilder';
import { refuseWindowOnToday, windowValue } from './QueryShorthand';
import { DateTimeInput, type DateTimeValue } from '../utils/values/DateValues';
import { IntValue } from '../utils/values/NumberValues';
import { holdsLineBreak } from '../utils/LineBreak';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';
import { formatTaskLine } from '../services/parsing/TaskLineFormat';
import {
    assertParams, LIMIT_PARAM, type ParamSpec,
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
    type SimpleFilterParams,
    type FilterSourceParams,
    type WindowParams,
} from './TaskApiTypes';

/*
 * A value holding a line break is refused (`holdsLineBreak`). Every value
 * here becomes part of one line of a note; a break would split it in two,
 * and the write layer refuses such a line whole (`LineBreakInLine`). Refused
 * here instead, where the caller can be told which parameter it was.
 *
 * A line break is what ends a line of a note: CR and LF. U+2028 and U+2029
 * are not — Obsidian keeps them inside the line, and so does every reader
 * here — so a value may hold them.
 */

/** Why an anchored ID finds no row: the one wording of it, for a read and a write. */
function anchorNotFound(id: string, file: string, anchor: string): string {
    return `Task not found: ${id} (no line of ${file} carries ^${anchor} alone)`;
}


// ── Internal helpers ──

/** The `sort` param, read by the one reader of sorts. A rule it cannot read is an error. */
function buildSortState(rules?: ApiSortRule[]): SortState | undefined {
    if (!rules || rules.length === 0) return undefined;
    const { state, issues } = SortSerializer.parse({ rules });
    if (issues.length > 0) {
        throw new TaskApiError(n => `Invalid ${n('sort')}: ${issues.map(sortIssueText).join('; ')}`, 'sort');
    }
    return state;
}

/** What every query takes: the params `resolveQuery` reads, and a sort. */
type QueryParams = SimpleFilterParams & FilterSourceParams & WindowParams & { sort?: ApiSortRule[] };

interface PaginateResult {
    paged: DisplayTask[];
    total: number;
    resolvedLimit: number | null;
}

function paginate(tasks: DisplayTask[], params: PaginationParams): PaginateResult {
    const total = tasks.length;
    const rawLimit = params.limit ?? 100;
    // Infinity is the CLI's `all`: no limit.
    if (rawLimit === Infinity) return { paged: tasks, total, resolvedLimit: null };
    const limit = intParam(rawLimit, 'limit', LIMIT_PARAM)!;
    return { paged: limit === 0 ? [] : tasks.slice(0, limit), total, resolvedLimit: limit };
}

/** A whole-number parameter, checked against its schema's range. */
function intParam(value: unknown, name: string, spec: ParamSpec): number | undefined {
    if (value === undefined) return undefined;
    const read = IntValue.check(value, spec.int);
    if (!read.ok) throw TaskApiError.ofIssue(read.issue, name, String(value));
    return read.value;
}

/**
 * A date-time parameter (`start`, `end`, `due`): a day that exists, an
 * optional `H:mm` time written back as `HH:mm`, typed text normalized. A
 * due takes its time only after a date (`timeOnly: 'refuse'`).
 */
function dateTimeParam(value: string, name: string, timeOnly: 'allow' | 'refuse'): DateTimeValue {
    const read = DateTimeInput.read(value, { timeOnly });
    if (!read.ok) throw TaskApiError.ofIssue(read.issue, name, value);
    return read.value;
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
    /** The index's copies, by name, by anchor and by line, and its changes. */
    private index: IndexReads;
    private operations: Operations;

    constructor(private plugin: PluginContext) {
        this.readService = plugin.getTaskReadService();
        this.index = plugin.getIndex();
        this.operations = plugin.getOperations();
    }

    private readonly lookup: TaskLookup = (name) => this.index.getTask(name);

    /** A task as the API hands it out, its IDs included (`apiIdOf`). */
    private readonly out = (task: DisplayTask): NormalizedTask => normalizeTask(task, this.lookup, this.plugin.settings.startHour);

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
            const task = this.index.getTaskByAnchor(read.file, read.anchor);
            if (!task) throw new TaskApiError(anchorNotFound(id, read.file, read.anchor));
            return task;
        }
        const task = this.index.getTask(read.name);
        if (!task) throw new TaskApiError(`Task not found: ${id} (an ID without a ^id lasts only until its file changes or the plugin reloads; list the tasks again)`);
        return task;
    }

    /**
     * {@link rowOf} for a write. An anchored ID outlives readings, so its row
     * is looked up in a reading of the note as the disk holds it
     * (`freshByAnchor`: the note is read again first when the disk holds
     * another content than the index read), and the write goes on with the
     * row the anchor finds there. A name is checked by the write itself,
     * which turns it away when the note changed (`Operations.copyToPlan`).
     */
    private async rowToWrite(id: string): Promise<Task> {
        const read = readApiId(id);
        if (read.kind !== 'anchor') return this.rowOf(id);
        const found = await this.operations.freshByAnchor(read.file, read.anchor);
        switch (found.kind) {
            case 'row': return found.task;
            case 'none': throw new TaskApiError(anchorNotFound(id, read.file, read.anchor));
            case 'unreadable': throw new TaskApiError(`Task ${id} could not be looked up: ${read.file} could not be read`);
        }
    }

    /**
     * The tasks a query names (`resolveQuery`: its params taken together),
     * in its order. `list`, `today` and the date-range family all answer
     * through it, so one FilterState answers each the same way.
     */
    private async queryTasks(params: QueryParams): Promise<DisplayTask[]> {
        const query = await resolveQuery(this.plugin.app, params);
        const sortState = buildSortState(params.sort) ?? query.sort;
        return this.readService.getFilteredTasks(query.filter ?? createEmptyFilterState(), sortState, { includeInvalid: query.includeInvalid });
    }

    /** A page of tasks as a listing hands it out. */
    private listResult(tasks: DisplayTask[], params: PaginationParams): TaskListResult {
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
     * List tasks with optional filters, sort, and pagination.
     */
    async list(params?: ListParams): Promise<TaskListResult> {
        assertParams(params ?? {}, LIST_SCHEMA, 'list');
        const p = params ?? {};
        return this.listResult(await this.queryTasks(p), p);
    }

    /**
     * List tasks active today: `list` with `date=today`, which takes every
     * param of `list` but another window.
     */
    async today(params?: TodayParams): Promise<TaskListResult> {
        const p = params ?? {};
        refuseWindowOnToday(p);
        assertParams(p, TODAY_SCHEMA, 'today');
        return this.listResult(await this.queryTasks({ ...p, date: 'today' }), p);
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

        if (holdsLineBreak(params.content)) throw new TaskApiError('content must not contain line breaks (\\r or \\n)');

        if (params.heading !== undefined && holdsLineBreak(params.heading)) throw new TaskApiError('heading must not contain line breaks (\\r or \\n)');

        const file = this.plugin.app.vault.getAbstractFileByPath(params.file);
        if (!(file instanceof TFile)) throw new TaskApiError(`File not found: ${params.file}`);
        const start = params.start ? dateTimeParam(params.start, 'start', 'allow') : undefined;
        const end = params.end ? dateTimeParam(params.end, 'end', 'allow') : undefined;
        // The notation's due is a date, with a time only after one.
        const due = params.due ? dateTimeParam(params.due, 'due', 'refuse') : undefined;
        const line = formatTaskLine({
            statusChar,
            content: params.content,
            startDate: start?.date,
            startTime: start?.time,
            endDate: end?.date,
            endTime: end?.time,
            due: DateUtils.joinDateTime(due?.date, due?.time),
        });

        const insertedLine = await this.operations.createTask(params.file, line, params.heading);
        if (insertedLine === null) throw new TaskApiError(`Task could not be written to: ${params.file}`);

        const created = this.index.getTaskByFileLine(params.file, insertedLine);
        if (!created) throw new TaskApiError('Task was created but could not be found after scan');

        return { task: this.out(toDisplayTask(created, this.plugin.settings.startHour, this.lookup)) };
    }

    /**
     * Update an existing task's fields.
     */
    async update(params: UpdateParams): Promise<MutationResult> {
        assertParams(params, UPDATE_SCHEMA, 'update');

        const task = await this.rowToWrite(params.id);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);

        const updates: Partial<Task> = {};

        if (params.content !== undefined) {
            if (holdsLineBreak(params.content)) throw new TaskApiError('content must not contain line breaks (\\r or \\n)');
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
                const parsed = dateTimeParam(params.start, 'start', 'allow');
                if (parsed.date) updates.startDate = parsed.date;
                if (parsed.time) updates.startTime = parsed.time;
            }
        }

        if (params.end !== undefined) {
            if (params.end === 'none') {
                updates.endDate = undefined;
                updates.endTime = undefined;
            } else {
                const parsed = dateTimeParam(params.end, 'end', 'allow');
                if (parsed.date) updates.endDate = parsed.date;
                if (parsed.time) updates.endTime = parsed.time;
            }
        }

        if (params.due !== undefined) {
            if (params.due === 'none') {
                updates.due = undefined;
            } else {
                const parsed = dateTimeParam(params.due, 'due', 'refuse');
                // The whole due, its time kept as create keeps it.
                updates.due = DateUtils.joinDateTime(parsed.date, parsed.time);
            }
        }

        // The write does not touch the index's copy: a write that was not
        // made leaves the copy saying what the file says, and reading it back
        // would report as done a change the file never took. A write that was
        // made is the index's next reading of the file (`landed`) by the time
        // it returns, so the read below sees the new values.
        const { written } = await this.operations.updateTask(task.id, updates);
        if (!written) throw new TaskApiError(`Task could not be written: ${params.id}`);

        // The row's name now: our write moved its file on, and the name is
        // followed across it (`TaskIndex.getTask`). An unanchored row's ID
        // changes with it.
        const updated = this.index.getTask(task.id);
        if (!updated) throw new TaskApiError(`Task not found after update: ${params.id}`);

        return { task: this.out(toDisplayTask(updated, this.plugin.settings.startHour, this.lookup)) };
    }

    /**
     * Delete a task.
     */
    async delete(params: DeleteParams): Promise<DeleteResult> {
        assertParams(params, DELETE_SCHEMA, 'delete');

        const task = await this.rowToWrite(params.id);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);

        const removed = await this.operations.deleteTask(task.id);
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
        const dayOffset = intParam(params.dayOffset, 'dayOffset', DUPLICATE_SCHEMA.dayOffset);
        const count = intParam(params.count, 'count', DUPLICATE_SCHEMA.count);
        const task = await this.rowToWrite(params.id);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.id} is read-only (parserId=${task.parserId})`);
        const written = await this.operations.duplicateTask(task.id, { dayOffset, count });
        if (!written) throw new TaskApiError(`Task could not be duplicated: ${params.id}`);
        return { duplicated: params.id };
    }

    /**
     * List tasks in a date range with optional filter, sort, and pagination:
     * `list` with `from` and `to`, both required.
     */
    async tasksForDateRange(params: TasksForDateRangeParams): Promise<TaskListResult> {
        assertParams(params, TASKS_FOR_DATE_RANGE_SCHEMA, 'tasksForDateRange');
        return this.listResult(await this.queryTasks(params), params);
    }

    /**
     * Get tasks in a date range, categorized into allDay/timed per date: the
     * tasks `list` with `from` and `to` answers, on each visual day of the
     * window the range names.
     */
    async categorizedTasksForDateRange(params: CategorizedTasksForDateRangeParams): Promise<CategorizedTasksForDateRangeResult> {
        assertParams(params, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA, 'categorizedTasksForDateRange');
        const tasks = await this.queryTasks(params);
        const startHour = this.plugin.settings.startHour;
        const window = ofValue(windowValue(params)!, this.readService.windowContext(startHour));
        const split = splitTasks(tasks, { type: 'visual-date', startHour });
        const dates = DateUtils.getDateRange(visualDayOf(window.startMs, startHour), endDayOf(window.endMs, startHour));
        const map = categorizeTasksByDate(split, dates, startHour);
        const result: CategorizedTasksForDateRangeResult = {};
        for (const [date, cats] of map) {
            result[date] = {
                allDay: cats.allDay.map(this.out),
                timed: cats.timed.map(this.out),
            };
        }
        return result;
    }

    /**
     * Insert a child task under a parent task.
     */
    async insertChildTask(params: InsertChildTaskParams): Promise<InsertChildTaskResult> {
        assertParams(params, INSERT_CHILD_TASK_SCHEMA, 'insertChildTask');
        if (holdsLineBreak(params.content)) throw new TaskApiError('content must not contain line breaks (\\r or \\n)');
        const task = await this.rowToWrite(params.parentId);
        if (task.isReadOnly) throw new TaskApiError(`Task ${params.parentId} is read-only (parserId=${task.parserId})`);
        const { written } = await this.operations.insertLine(task.id, formatTaskLine({ statusChar: ' ', content: params.content }), 'firstChild');
        if (!written) throw new TaskApiError(`Child task could not be written under: ${params.parentId}`);
        return { parentId: params.parentId };
    }

    /**
     * Get the current startHour setting (visual day boundary).
     */
    getStartHour(): StartHourResult {
        return { startHour: this.plugin.settings.startHour };
    }

    /**
     * Subscribe to task changes. Returns an unsubscribe function.
     */
    onChange(callback: (taskId?: string) => void): () => void {
        // The ID given is the API's (`apiIdOf`), like every other it hands out.
        return this.index.onChange(taskId => callback(taskId === undefined ? undefined : apiIdOf(taskId, this.lookup)));
    }

    /**
     * Return API reference text.
     */
    help(): string {
        return API_REFERENCE;
    }
}
