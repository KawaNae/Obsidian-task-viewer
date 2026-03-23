import type { DisplayTask } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import type { CategorizedTasks as BaseCategorizedTasks } from '../../../services/data/TaskReadService';
import type { CategorizedTasks, TimedDisplayTask } from '../ScheduleTypes';
import type { ScheduleGridCalculator } from './ScheduleGridCalculator';

export interface ScheduleTaskCategorizerOptions {
    getStartHour: () => number;
    gridCalculator: ScheduleGridCalculator;
}

export class ScheduleTaskCategorizer {
    private readonly getStartHour: () => number;
    private readonly gridCalculator: ScheduleGridCalculator;

    constructor(options: ScheduleTaskCategorizerOptions) {
        this.getStartHour = options.getStartHour;
        this.gridCalculator = options.gridCalculator;
    }

    /**
     * Convert base CategorizedTasks (from TaskReadService) to Schedule-specific format.
     * Adds visualStartMinute/visualEndMinute to timed tasks and applies sorting.
     */
    toScheduleFormat(base: BaseCategorizedTasks): CategorizedTasks {
        const categorized: CategorizedTasks = {
            allDay: [...base.allDay],
            timed: [],
            dueOnly: [...base.dueOnly],
        };

        for (const dt of base.timed) {
            const timedTask = this.toTimedDisplayTask(dt);
            if (timedTask) {
                categorized.timed.push(timedTask);
            } else {
                // Falls back to allDay if can't compute visual minutes
                categorized.allDay.push(dt);
            }
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
}
