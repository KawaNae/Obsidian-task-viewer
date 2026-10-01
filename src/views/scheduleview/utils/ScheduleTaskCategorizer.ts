import type { DisplayTask } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import type { CategorizedTasks as BaseCategorizedTasks } from '../../../services/display/TaskDateCategorizer';
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
     * Convert base CategorizedTasks (from TaskDateCategorizer) to Schedule's
     * format: each timed task gets its visualStartMinute/visualEndMinute.
     * Every section keeps the canonical order it comes in (TaskRenderOrder),
     * the one Timeline draws in too.
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
        const durationMs = dt.effectiveStartTime ? DateUtils.getDisplayTaskDurationMs(dt, this.getStartHour()) : null;
        if (durationMs === null || durationMs <= 0) {
            return DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
        }

        return Math.max(1, Math.round(durationMs / (1000 * 60)));
    }
}
