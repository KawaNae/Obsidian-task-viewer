import type { Task, DisplayTask, ChildEntry } from '../../types';
import type { FilterState, FilterContext } from '../filter/FilterTypes';
import { hasConditions } from '../filter/FilterTypes';
import type { SortState } from '../sort/SortTypes';
import type { TaskIndex } from '../core/TaskIndex';
import { toDisplayTask, toDisplayTasks } from '../display/DisplayTaskConverter';
import { TaskFilterEngine } from '../filter/TaskFilterEngine';
import { TaskSorter } from '../sort/TaskSorter';
import { DateUtils } from '../../utils/DateUtils';
import { getTaskDateRange } from '../display/VisualDateRange';
import { buildChildEntries } from './ChildEntryBuilder';

/**
 * Read-side entry point for views and interaction handlers.
 *
 * Provides cached DisplayTask conversion, date-based filtering/splitting,
 * and shared FilterContext creation. Used by both internal views and
 * the public TaskApi.
 */
export class TaskReadService {
    private cachedDisplayTasks: DisplayTask[] | null = null;
    private cacheRevision: number = -1;

    constructor(
        private taskIndex: TaskIndex,
        private startHour: number
    ) {}

    /** Update startHour (call on settings change). Invalidates cache. */
    updateStartHour(startHour: number): void {
        if (this.startHour !== startHour) {
            this.startHour = startHour;
            this.cachedDisplayTasks = null;
        }
    }

    /** Current startHour value. */
    getStartHour(): number {
        return this.startHour;
    }

    // ===== Raw task access (proxied from TaskIndex) =====

    /** All raw tasks. Primary use: FilterMenu callbacks. */
    getTasks(): Task[] {
        return this.taskIndex.getTasks();
    }

    /** Single raw task lookup. Primary use: FilterMenu, child resolution, drag validation, export masking. */
    getTask(taskId: string): Task | undefined {
        return this.taskIndex.getTask(taskId);
    }

    /** Inline task lookup by file + line. Primary use: editor extensions. */
    getTaskByFileLine(filePath: string, line: number): Task | undefined {
        return this.taskIndex.getTaskByFileLine(filePath, line);
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

    // ===== Event subscription =====

    /** Subscribe to task changes. Returns unsubscribe function. */
    onChange(callback: (taskId?: string, changes?: string[]) => void): () => void {
        return this.taskIndex.onChange(callback);
    }

    // ===== Core data access =====

    /**
     * All DisplayTasks, revision-cached.
     * Recomputed only when TaskStore revision changes.
     */
    getAllDisplayTasks(): DisplayTask[] {
        const currentRevision = this.taskIndex.getRevision();
        if (this.cachedDisplayTasks && this.cacheRevision === currentRevision) {
            return this.cachedDisplayTasks;
        }
        const lookup = this.taskLookup;
        this.cachedDisplayTasks = toDisplayTasks(this.taskIndex.getTasks(), this.startHour, lookup);
        this.cacheRevision = currentRevision;
        return this.cachedDisplayTasks;
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
        filter?: FilterState
    ): DisplayTask[] {
        const all = this.getAllDisplayTasks();
        const context = filter ? this.createFilterContext() : undefined;
        const startHour = this.startHour;

        const result: DisplayTask[] = [];
        for (const dt of all) {
            if (filter && !TaskFilterEngine.evaluate(dt, filter, context)) continue;
            if (!dt.effectiveStartDate) {
                // D type (due-only): include if due is in range
                if (dt.due && dt.due >= startDate && dt.due <= endDate) {
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
    getFilteredTasks(filter: FilterState, sort?: SortState): DisplayTask[] {
        const all = this.getAllDisplayTasks();
        if (!hasConditions(filter)) {
            const result = [...all];
            if (sort) TaskSorter.sort(result, sort);
            return result;
        }
        const context = this.createFilterContext();
        const result = all.filter(t => TaskFilterEngine.evaluate(t, filter, context));
        if (sort) TaskSorter.sort(result, sort);
        return result;
    }

    /**
     * Create a FilterContext with startHour and taskLookup.
     */
    private createFilterContext(): FilterContext {
        return {
            startHour: this.startHour,
            taskLookup: (id: string) => this.taskIndex.getTask(id),
        };
    }

}
