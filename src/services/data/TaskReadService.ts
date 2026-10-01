import type { Task, DisplayTask, ChildEntry, TaskViewerSettings } from '../../types';
import type { FilterState } from '../filter/FilterTypes';
import type { FilterContext } from '../filter/FilterContext';
import { hasConditions } from '../filter/FilterTypes';
import type { SortState } from '../sort/SortTypes';
import type { IndexReads } from '../core/TaskIndex';
import { toDisplayTask, toDisplayTasks } from '../display/DisplayTaskConverter';
import { TaskFilterEngine } from '../filter/TaskFilterEngine';
import { TaskSorter } from '../sort/TaskSorter';
import { getTaskDateRange } from '../display/VisualDateRange';
import { DateUtils } from '../../utils/DateUtils';
import { buildChildEntries } from './ChildEntryBuilder';

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
     * All DisplayTasks, revision-cached.
     * Recomputed when the index's revision or the startHour changes.
     */
    getAllDisplayTasks(): DisplayTask[] {
        const currentRevision = this.taskIndex.getRevision();
        const startHour = this.startHour;
        if (this.cachedDisplayTasks && this.cacheRevision === currentRevision && this.cacheStartHour === startHour) {
            return this.cachedDisplayTasks;
        }
        const lookup = this.taskLookup;
        this.cachedDisplayTasks = toDisplayTasks(this.taskIndex.getTasks(), startHour, lookup);
        this.cacheRevision = currentRevision;
        this.cacheStartHour = startHour;
        return this.cachedDisplayTasks;
    }

    getVisibleDisplayTasks(): DisplayTask[] {
        return this.getAllDisplayTasks().filter(TaskReadService.isVisible);
    }

    /**
     * Single task → DisplayTask conversion (for partial updates).
     * Does NOT use the batch cache.
     */
    getDisplayTask(taskId: string): DisplayTask | undefined {
        const task = this.taskIndex.getTask(taskId);
        if (!task) return undefined;
        return toDisplayTask(task, this.startHour, this.taskLookup);
    }

    private readonly taskLookup = (id: string): Task | undefined => this.taskIndex.getTask(id);

    // ===== Date-based queries =====

    /**
     * Tasks in a date range, using visual dates (startHour-aware) for timed tasks.
     * Returns flat DisplayTask[] (no split, no categorization).
     */
    getTasksForDateRange(
        startDate: string,
        endDate: string,
        filter?: FilterState,
        options?: { includeInvalid?: boolean }
    ): DisplayTask[] {
        const raw = this.getAllDisplayTasks();
        const all = options?.includeInvalid ? raw : raw.filter(TaskReadService.isVisible);
        const context = filter ? this.createFilterContext() : undefined;
        const startHour = this.startHour;

        const result: DisplayTask[] = [];
        for (const dt of all) {
            if (filter && !TaskFilterEngine.evaluate(dt, filter, context)) continue;
            if (!dt.effectiveStartDate) {
                // D type (due-only): include if due is in range
                const duePart = DateUtils.dueDatePart(dt.effectiveDue);
                if (duePart && duePart >= startDate && duePart <= endDate) {
                    result.push(dt);
                }
                continue;
            }

            if (dt.effectiveStartTime) {
                // Timed task: use visual dates for overlap check
                const range = getTaskDateRange(dt, startHour);
                const visualStart = range.effectiveStart || dt.effectiveStartDate;
                const visualEnd = range.effectiveEnd || visualStart;
                if (visualStart <= endDate && visualEnd >= startDate) {
                    result.push(dt);
                }
            } else {
                // allDay task: use effectiveStartDate/effectiveEndDate overlap
                const taskEnd = dt.effectiveEndDate || dt.effectiveStartDate;
                if (dt.effectiveStartDate <= endDate && taskEnd >= startDate) {
                    result.push(dt);
                }
            }
        }
        return result;
    }

    // ===== Filter + Sort =====

    /**
     * Filtered (and optionally sorted) tasks.
     * Primary API for views needing filtered results.
     */
    getFilteredTasks(filter: FilterState, sort?: SortState, options?: { includeInvalid?: boolean }): DisplayTask[] {
        const raw = this.getAllDisplayTasks();
        const all = options?.includeInvalid ? raw : raw.filter(TaskReadService.isVisible);
        if (!hasConditions(filter)) {
            const result = [...all];
            TaskSorter.sort(result, sort);
            return result;
        }
        const context = this.createFilterContext();
        const result = all.filter(t => TaskFilterEngine.evaluate(t, filter, context));
        TaskSorter.sort(result, sort);
        return result;
    }

    /**
     * Create a FilterContext with startHour and taskLookup.
     */
    private createFilterContext(): FilterContext {
        return {
            startHour: this.startHour,
            weekStartDay: this.settings().weekStartDay,
            taskLookup: (id: string) => this.taskIndex.getTask(id),
        };
    }

}
