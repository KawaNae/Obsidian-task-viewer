import type { Task, DisplayTask, ChildEntry, TaskViewerSettings } from '../../types';
import type { FilterState } from '../filter/FilterTypes';
import type { FilterContext } from '../filter/FilterContext';
import { hasConditions } from '../filter/FilterTypes';
import type { SortState } from '../sort/SortTypes';
import type { IndexReads } from '../core/TaskIndex';
import { toDisplayTask, toDisplayTasks } from '../display/DisplayTaskConverter';
import { TaskFilterEngine } from '../filter/TaskFilterEngine';
import { compileFilter, ALWAYS } from '../filter/FilterExpr';
import { TaskSorter } from '../sort/TaskSorter';
import type { TimeWindow } from '../../utils/DayWindow';
import { overlaps } from '../../utils/SpanRelation';
import { buildChildEntries } from './ChildEntryBuilder';

/**
 * How a question is answered besides its filter: whether the tasks with a
 * validation error are among the answers, and the start hour the copies are
 * drawn with and the filter's days are placed by (the setting's when absent;
 * the API's `startHour` names another for one call).
 */
export interface QueryOptions {
    includeInvalid?: boolean;
    startHour?: number;
}

/**
 * The display side of the read: the index's copies as a view draws them.
 *
 * Provides cached DisplayTask conversion, date-based filtering/splitting,
 * a row's children in the note's order, and shared FilterContext creation.
 * Used by both internal views and the public TaskApi.
 *
 * The copies themselves — by name, by anchor, by line, and the index's
 * changes — are the index's to answer (`IndexReads`, `PluginContext.getIndex`);
 * nothing here passes them through.
 */
export class TaskReadService {
    private cachedDisplayTasks: DisplayTask[] | null = null;
    private cacheRevision: number = -1;
    /** The startHour the cached copies were drawn with: a change of it redraws them. */
    private cacheStartHour: number = -1;

    /**
     * `settings` is read at each question, so what the service answers is
     * always the current settings; nothing has to push a change in.
     */
    constructor(
        private taskIndex: IndexReads,
        private settings: () => Pick<TaskViewerSettings, 'startHour' | 'weekStartDay'>,
    ) {}

    private get startHour(): number {
        return this.settings().startHour;
    }

    /**
     * Ordered ChildEntry[] for a task. Source of truth for the renderer.
     *
     * Each entry carries an absolute `bodyLine`, so callers never recompute
     * line numbers. Sibling subtree overlap is filtered out, enforcing the
     * "1 line = 1 owner" invariant the new render path relies on.
     */
    getChildEntries(task: Task): ChildEntry[] {
        return buildChildEntries(task, (id) => this.taskIndex.getTask(id));
    }

    // ===== Core data access =====

    private static isVisible(dt: DisplayTask): boolean {
        return !dt.validation || dt.validation.severity !== 'error';
    }

    /**
     * All DisplayTasks, as drawn with the setting's startHour; revision-cached.
     * Recomputed when the index's revision or the startHour changes.
     */
    getAllDisplayTasks(): DisplayTask[] {
        return this.displayTasksAt(this.startHour);
    }

    /**
     * All DisplayTasks, as drawn with `startHour`. The setting's are the
     * cached ones; another start hour (a call's own, `QueryOptions`) draws
     * them anew and keeps nothing, so a call never makes the views' next
     * question draw them again.
     */
    displayTasksAt(startHour: number): DisplayTask[] {
        if (startHour !== this.startHour) {
            return toDisplayTasks(this.taskIndex.getTasks(), startHour, this.taskLookup);
        }
        const currentRevision = this.taskIndex.getRevision();
        if (this.cachedDisplayTasks && this.cacheRevision === currentRevision && this.cacheStartHour === startHour) {
            return this.cachedDisplayTasks;
        }
        this.cachedDisplayTasks = toDisplayTasks(this.taskIndex.getTasks(), startHour, this.taskLookup);
        this.cacheRevision = currentRevision;
        this.cacheStartHour = startHour;
        return this.cachedDisplayTasks;
    }

    getVisibleDisplayTasks(): DisplayTask[] {
        return this.getAllDisplayTasks().filter(TaskReadService.isVisible);
    }

    /**
     * Single task → DisplayTask conversion (for partial updates), drawn
     * with `startHour` (the setting's when absent).
     * Does NOT use the batch cache.
     */
    getDisplayTask(taskId: string, startHour: number = this.startHour): DisplayTask | undefined {
        const task = this.taskIndex.getTask(taskId);
        if (!task) return undefined;
        return toDisplayTask(task, startHour, this.taskLookup);
    }

    private readonly taskLookup = (id: string): Task | undefined => this.taskIndex.getTask(id);

    // ===== Date-based queries =====

    /**
     * The tasks whose span overlaps the window (`daysWindow` for visual
     * days), filtered. A task with only a due has the span read from it, so
     * it is found on the day it is drawn. Returns flat DisplayTask[] (no
     * split, no categorization).
     */
    tasksInWindow(
        window: TimeWindow,
        filter?: FilterState,
        options?: QueryOptions
    ): DisplayTask[] {
        const startHour = options?.startHour ?? this.startHour;
        const raw = this.displayTasksAt(startHour);
        const all = options?.includeInvalid ? raw : raw.filter(TaskReadService.isVisible);
        const context = this.windowContext(startHour);
        const expr = filter ? compileFilter(filter) : ALWAYS;
        return all.filter(dt => TaskReadService.inWindow(dt, window)
            && TaskFilterEngine.evaluate(dt, expr, context));
    }

    /** Whether a task is in the window: its span overlaps it (a task with only a due has the span read from it). */
    private static inWindow(dt: DisplayTask, window: TimeWindow): boolean {
        return !!dt.span && overlaps(dt.span, window);
    }

    // ===== Filter + Sort =====

    /**
     * Filtered (and optionally sorted) tasks.
     * Primary API for views needing filtered results.
     */
    getFilteredTasks(filter: FilterState, sort?: SortState, options?: QueryOptions): DisplayTask[] {
        const startHour = options?.startHour ?? this.startHour;
        const raw = this.displayTasksAt(startHour);
        const all = options?.includeInvalid ? raw : raw.filter(TaskReadService.isVisible);
        if (!hasConditions(filter)) {
            const result = [...all];
            TaskSorter.sort(result, sort);
            return result;
        }
        const context = this.windowContext(startHour);
        const expr = compileFilter(filter);
        const result = all.filter(t => TaskFilterEngine.evaluate(t, expr, context));
        TaskSorter.sort(result, sort);
        return result;
    }

    /**
     * The context the plugin evaluates filters in: the start hour (the
     * setting's when absent), the week's first day, its index, and now. A
     * window a value names is placed by it, wherever it is placed.
     */
    windowContext(startHour: number = this.startHour): FilterContext {
        return {
            startHour,
            weekStartDay: this.settings().weekStartDay,
            taskLookup: (id: string) => this.taskIndex.getTask(id),
            now: new Date(),
        };
    }

}
