import type { DisplayTask } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import type { TaskIndex } from '../../../services/core/TaskIndex';
import {
    toDisplayTask,
    shouldSplitDisplayTask,
    splitDisplayTaskAtBoundary,
} from '../../../utils/DisplayTaskConverter';
import type { FilterMenuComponent } from '../../customMenus/FilterMenuComponent';
import type { CategorizedTasks, TimedDisplayTask } from '../ScheduleTypes';
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

    categorizeTasksBySection(tasks: DisplayTask[], dateStr: string): CategorizedTasks {
        const categorized: CategorizedTasks = {
            allDay: [],
            timed: [],
            dueOnly: [],
        };

        for (const task of tasks) {
            if (this.isDueOnlyTaskOnDate(task, dateStr)) {
                categorized.dueOnly.push(task);
                continue;
            }

            if (this.isTimedTask(task)) {
                const timedTask = this.toTimedDisplayTask(task);
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

        categorized.dueOnly.sort((a, b) => {
            const aDue = a.due || '';
            const bDue = b.due || '';
            if (aDue !== bDue) {
                return aDue.localeCompare(bDue);
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        return categorized;
    }

    getTasksForDate(dateStr: string): DisplayTask[] {
        const result: DisplayTask[] = [];
        const startHour = this.getStartHour();
        const allTasks = this.taskIndex.getTasks();
        for (const task of allTasks) {
            const dt = toDisplayTask(task, startHour);
            if (!this.filterMenu.isTaskVisible(dt)) {
                continue;
            }
            result.push(...this.getDisplayTasksForDate(dt, dateStr));
        }
        return result;
    }

    private getDisplayTasksForDate(dt: DisplayTask, dateStr: string): DisplayTask[] {
        if (this.isTimedTask(dt)) {
            return this.getTimedTaskSegmentsForDate(dt, dateStr);
        }

        if (this.isAllDayLikeTaskOnDate(dt, dateStr)) {
            return [dt];
        }

        if (this.isDueOnlyTaskOnDate(dt, dateStr)) {
            return [dt];
        }

        return [];
    }

    private toTimedDisplayTask(dt: DisplayTask): TimedDisplayTask | null {
        if (!dt.effectiveStartTime) {
            return null;
        }

        const dayStart = this.gridCalculator.getDayStartMinute();
        const dayEnd = this.gridCalculator.getDayEndMinute();
        const durationMinutes = this.calculateDurationMinutes(dt);
        const rawStart = this.gridCalculator.timeToVisualMinute(dt.effectiveStartTime);
        const rawEnd = rawStart + durationMinutes;

        const visualStartMinute = Math.max(dayStart, Math.min(dayEnd - 1, rawStart));
        const visualEndMinute = Math.max(visualStartMinute + 1, Math.min(dayEnd, rawEnd));

        return {
            ...dt,
            visualStartMinute,
            visualEndMinute,
        };
    }

    private calculateDurationMinutes(dt: DisplayTask): number {
        if (!dt.effectiveStartDate || !dt.effectiveStartTime) {
            return DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
        }

        const durationMs = DateUtils.getTaskDurationMs(
            dt.effectiveStartDate,
            dt.effectiveStartTime,
            dt.effectiveEndDate,
            dt.effectiveEndTime,
            this.getStartHour()
        );

        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
        }

        return Math.max(1, Math.round(durationMs / (1000 * 60)));
    }

    private getTimedTaskSegmentsForDate(dt: DisplayTask, dateStr: string): DisplayTask[] {
        if (!dt.effectiveStartTime) {
            return [];
        }

        const startHour = this.getStartHour();
        const segments: DisplayTask[] = [];

        if (shouldSplitDisplayTask(dt, startHour)) {
            const [before, after] = splitDisplayTaskAtBoundary(dt, startHour);
            const beforeVisualDate = DateUtils.getVisualStartDate(before.effectiveStartDate, before.effectiveStartTime!, startHour);
            const afterVisualDate = DateUtils.getVisualStartDate(after.effectiveStartDate, after.effectiveStartTime!, startHour);

            if (beforeVisualDate === dateStr) {
                segments.push(before);
            }
            if (afterVisualDate === dateStr) {
                segments.push(after);
            }
            return segments;
        }

        const visualDate = DateUtils.getVisualStartDate(dt.effectiveStartDate, dt.effectiveStartTime, startHour);
        if (visualDate === dateStr) {
            segments.push(dt);
        }
        return segments;
    }

    private isTimedTask(dt: DisplayTask): boolean {
        if (!dt.effectiveStartDate || !dt.effectiveStartTime) {
            return false;
        }
        return !DateUtils.isAllDayTask(
            dt.effectiveStartDate,
            dt.effectiveStartTime,
            dt.effectiveEndDate,
            dt.effectiveEndTime,
            this.getStartHour()
        );
    }

    private isAllDayLikeTaskOnDate(dt: DisplayTask, dateStr: string): boolean {
        if (!dt.effectiveStartDate) {
            return false;
        }

        if (dt.effectiveStartTime && this.isTimedTask(dt)) {
            return false;
        }

        if (dt.effectiveEndDate && dt.effectiveEndDate >= dt.effectiveStartDate) {
            return dateStr >= dt.effectiveStartDate && dateStr <= dt.effectiveEndDate;
        }

        return dt.effectiveStartDate === dateStr;
    }

    private isDueOnlyTaskOnDate(dt: DisplayTask, dateStr: string): boolean {
        if (!dt.due) {
            return false;
        }
        if (dt.startDate || dt.endDate) {
            return false;
        }
        const dueDate = dt.due.split('T')[0];
        return dueDate === dateStr;
    }
}
