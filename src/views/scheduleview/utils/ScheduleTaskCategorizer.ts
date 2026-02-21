import type { Task } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import type { TaskIndex } from '../../../services/core/TaskIndex';
import { shouldSplitTask, splitTaskAtBoundary, type RenderableTask } from '../../utils/RenderableTaskUtils';
import type { FileFilterMenu } from '../../ViewToolbar';
import type { CategorizedTasks, TimedRenderableTask } from '../ScheduleTypes';
import type { ScheduleGridCalculator } from './ScheduleGridCalculator';

export interface ScheduleTaskCategorizerOptions {
    taskIndex: TaskIndex;
    filterMenu: FileFilterMenu;
    getStartHour: () => number;
    gridCalculator: ScheduleGridCalculator;
}

export class ScheduleTaskCategorizer {
    private readonly taskIndex: TaskIndex;
    private readonly filterMenu: FileFilterMenu;
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
            if (!this.filterMenu.isFileVisible(task.file)) {
                continue;
            }
            result.push(...this.getRenderableTasksForDate(task, dateStr));
        }
        return result;
    }

    getFilterableFiles(dateStr: string): string[] {
        const files = new Set<string>();
        const allTasks = this.taskIndex.getTasks();

        for (const task of allTasks) {
            const renderableTasks = this.getRenderableTasksForDate(task, dateStr);
            if (renderableTasks.length > 0) {
                files.add(task.file);
            }
        }

        return Array.from(files).sort();
    }

    private toTimedRenderableTask(task: RenderableTask): TimedRenderableTask | null {
        if (!task.startTime) {
            return null;
        }

        const dayStart = this.gridCalculator.getDayStartMinute();
        const dayEnd = this.gridCalculator.getDayEndMinute();
        const durationMinutes = this.calculateDurationMinutes(task);
        const rawStart = this.gridCalculator.timeToVisualMinute(task.startTime);
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
        if (!task.startDate || !task.startTime) {
            return 60;
        }

        const durationMs = DateUtils.getTaskDurationMs(
            task.startDate,
            task.startTime,
            task.endDate,
            task.endTime,
            this.getStartHour()
        );

        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return 60;
        }

        return Math.max(1, Math.round(durationMs / (1000 * 60)));
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

    private getTimedTaskSegmentsForDate(task: Task, dateStr: string): RenderableTask[] {
        if (!task.startDate || !task.startTime) {
            return [];
        }

        const startHour = this.getStartHour();
        const segments: RenderableTask[] = [];

        if (shouldSplitTask(task, startHour)) {
            const [before, after] = splitTaskAtBoundary(task, startHour);
            const beforeDate = DateUtils.getVisualStartDate(before.startDate!, before.startTime!, startHour);
            const afterDate = DateUtils.getVisualStartDate(after.startDate!, after.startTime!, startHour);

            if (beforeDate === dateStr) {
                segments.push(this.toRenderableTask(before));
            }
            if (afterDate === dateStr) {
                segments.push(this.toRenderableTask(after));
            }
            return segments;
        }

        const visualDate = DateUtils.getVisualStartDate(task.startDate, task.startTime, startHour);
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

    private isTimedTask(task: Task): boolean {
        if (!task.startDate || !task.startTime) {
            return false;
        }
        return !DateUtils.isAllDayTask(
            task.startDate,
            task.startTime,
            task.endDate,
            task.endTime,
            this.getStartHour()
        );
    }

    private isAllDayLikeTaskOnDate(task: Task, dateStr: string): boolean {
        if (!task.startDate) {
            return false;
        }

        if (task.startTime && this.isTimedTask(task)) {
            return false;
        }

        if (task.endDate && task.endDate >= task.startDate) {
            return dateStr >= task.startDate && dateStr <= task.endDate;
        }

        return task.startDate === dateStr;
    }

    private isDeadlineOnlyTaskOnDate(task: Task, dateStr: string): boolean {
        if (!task.deadline) {
            return false;
        }
        if (task.startDate) {
            return false;
        }
        const deadlineDate = task.deadline.split('T')[0];
        return deadlineDate === dateStr;
    }
}
