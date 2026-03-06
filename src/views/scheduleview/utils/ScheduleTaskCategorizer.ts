import type { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import { ImplicitCalendarDateResolver } from '../../../utils/ImplicitCalendarDateResolver';
import type { TaskIndex } from '../../../services/core/TaskIndex';
import { shouldSplitTask, splitTaskAtBoundary, type RenderableTask } from '../../sharedLogic/RenderableTaskUtils';
import type { FilterMenuComponent } from '../../customMenus/FilterMenuComponent';
import type { CategorizedTasks, TimedRenderableTask } from '../ScheduleTypes';
import type { ScheduleGridCalculator } from './ScheduleGridCalculator';

export interface ScheduleTaskCategorizerOptions {
    taskIndex: TaskIndex;
    filterMenu: FilterMenuComponent;
    getStartHour: () => number;
    gridCalculator: ScheduleGridCalculator;
}

export class ScheduleTaskCategorizer {
    private readonly taskIndex: TaskIndex;
    private readonly filterMenu: FilterMenuComponent;
    private readonly getStartHour: () => number;
    private readonly gridCalculator: ScheduleGridCalculator;

    constructor(options: ScheduleTaskCategorizerOptions) {
        this.taskIndex = options.taskIndex;
        this.filterMenu = options.filterMenu;
        this.getStartHour = options.getStartHour;
        this.gridCalculator = options.gridCalculator;
    }

    categorizeTasksBySection(tasks: RenderableTask[], dateStr: string): CategorizedTasks {
        const categorized: CategorizedTasks = {
            allDay: [],
            timed: [],
            deadlines: [],
        };

        for (const task of tasks) {
            if (this.isDeadlineOnlyTaskOnDate(task, dateStr)) {
                categorized.deadlines.push(task);
                continue;
            }

            if (this.isTimedTask(task)) {
                const timedTask = this.toTimedRenderableTask(task);
                if (timedTask) {
                    categorized.timed.push(timedTask);
                    continue;
                }
            }

            categorized.allDay.push(task);
        }

        categorized.allDay.sort((a, b) => {
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        categorized.timed.sort((a, b) => {
            if (a.visualStartMinute !== b.visualStartMinute) {
                return a.visualStartMinute - b.visualStartMinute;
            }
            if (a.visualEndMinute !== b.visualEndMinute) {
                return a.visualEndMinute - b.visualEndMinute;
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        categorized.deadlines.sort((a, b) => {
            const aDeadline = a.deadline || '';
            const bDeadline = b.deadline || '';
            if (aDeadline !== bDeadline) {
                return aDeadline.localeCompare(bDeadline);
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        return categorized;
    }

    getTasksForDate(dateStr: string): RenderableTask[] {
        const result: RenderableTask[] = [];
        const allTasks = this.taskIndex.getTasks();
        for (const task of allTasks) {
            if (!this.filterMenu.isTaskVisible(task)) {
                continue;
            }
            result.push(...this.getRenderableTasksForDate(task, dateStr));
        }
        return result;
    }

    private getRenderableTasksForDate(task: Task, dateStr: string): RenderableTask[] {
        if (this.isTimedTask(task)) {
            return this.getTimedTaskSegmentsForDate(task, dateStr);
        }

        if (this.isAllDayLikeTaskOnDate(task, dateStr)) {
            return [this.toRenderableTask(task)];
        }

        if (this.isDeadlineOnlyTaskOnDate(task, dateStr)) {
            return [this.toRenderableTask(task)];
        }

        return [];
    }

    private toTimedRenderableTask(task: RenderableTask): TimedRenderableTask | null {
        const effective = this.resolveEffectiveStart(task);
        if (!effective?.startTime) {
            return null;
        }

        const dayStart = this.gridCalculator.getDayStartMinute();
        const dayEnd = this.gridCalculator.getDayEndMinute();
        const durationMinutes = this.calculateDurationMinutes(task);
        const rawStart = this.gridCalculator.timeToVisualMinute(effective.startTime);
        const rawEnd = rawStart + durationMinutes;

        const visualStartMinute = Math.max(dayStart, Math.min(dayEnd - 1, rawStart));
        const visualEndMinute = Math.max(visualStartMinute + 1, Math.min(dayEnd, rawEnd));

        return {
            ...task,
            visualStartMinute,
            visualEndMinute,
        };
    }

    private calculateDurationMinutes(task: RenderableTask): number {
        const effective = this.resolveEffectiveStart(task);
        if (!effective || !effective.startTime) {
            return DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
        }

        const durationMs = DateUtils.getTaskDurationMs(
            effective.startDate,
            effective.startTime,
            task.endDate,
            task.endTime,
            this.getStartHour()
        );

        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
        }

        return Math.max(1, Math.round(durationMs / (1000 * 60)));
    }

    private getTimedTaskSegmentsForDate(task: Task, dateStr: string): RenderableTask[] {
        const effective = this.resolveEffectiveStart(task);
        if (!effective || !effective.startTime) {
            return [];
        }

        const startHour = this.getStartHour();
        const segments: RenderableTask[] = [];

        // Build an effective task with resolved start for split/visual calculations
        const effectiveTask = { ...task, startDate: effective.startDate, startTime: effective.startTime };

        if (shouldSplitTask(effectiveTask, startHour)) {
            const [before, after] = splitTaskAtBoundary(effectiveTask, startHour);
            const beforeVisualDate = DateUtils.getVisualStartDate(before.startDate!, before.startTime!, startHour);
            const afterVisualDate = DateUtils.getVisualStartDate(after.startDate!, after.startTime!, startHour);

            if (beforeVisualDate === dateStr) {
                segments.push(this.toRenderableTask(before));
            }
            if (afterVisualDate === dateStr) {
                segments.push(this.toRenderableTask(after));
            }
            return segments;
        }

        const visualDate = DateUtils.getVisualStartDate(effective.startDate, effective.startTime, startHour);
        if (visualDate === dateStr) {
            segments.push(this.toRenderableTask(task));
        }
        return segments;
    }

    private toRenderableTask(task: Task | RenderableTask): RenderableTask {
        const renderable = task as RenderableTask;
        return {
            ...task,
            id: task.id,
            originalTaskId: renderable.originalTaskId ?? task.id,
            isSplit: renderable.isSplit ?? false,
            splitSegment: renderable.splitSegment,
        };
    }

    /** Resolve effective start for E/ED types (derive from endDate). */
    private resolveEffectiveStart(task: Task): { startDate: string; startTime?: string } | null {
        if (task.startDate) return { startDate: task.startDate, startTime: task.startTime };
        return ImplicitCalendarDateResolver.resolveImplicitStart(task, this.getStartHour());
    }

    private isTimedTask(task: Task): boolean {
        const effective = this.resolveEffectiveStart(task);
        if (!effective || !effective.startTime) {
            return false;
        }
        return !DateUtils.isAllDayTask(
            effective.startDate,
            effective.startTime,
            task.endDate,
            task.endTime,
            this.getStartHour()
        );
    }

    private isAllDayLikeTaskOnDate(task: Task, dateStr: string): boolean {
        const effective = this.resolveEffectiveStart(task);
        if (!effective) {
            return false;
        }

        if (effective.startTime && this.isTimedTask(task)) {
            return false;
        }

        if (task.endDate && task.endDate >= effective.startDate) {
            return dateStr >= effective.startDate && dateStr <= task.endDate;
        }

        return effective.startDate === dateStr;
    }

    private isDeadlineOnlyTaskOnDate(task: Task, dateStr: string): boolean {
        if (!task.deadline) {
            return false;
        }
        if (task.startDate || task.endDate) {
            return false;
        }
        const deadlineDate = task.deadline.split('T')[0];
        return deadlineDate === dateStr;
    }
}
