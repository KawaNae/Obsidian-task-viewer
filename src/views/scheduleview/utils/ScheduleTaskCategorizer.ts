import type { DisplayTask } from '../../../types';
import { DateUtils } from '../../../utils/DateUtils';
import { minutesOfSpan } from '../../../utils/DayWindow';
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
        if (!dt.drawn) return null;

        // What the card is drawn over, in minutes from midnight of its visual day.
        const dayStart = this.gridCalculator.getDayStartMinute();
        const dayEnd = this.gridCalculator.getDayEndMinute();
        const minutes = minutesOfSpan(dt.drawn, this.getStartHour());
        const rawStart = dayStart + minutes.start;
        // A point is drawn with the default length, as before.
        const rawEnd = dayStart + (minutes.end > minutes.start ? minutes.end : minutes.start + DateUtils.DEFAULT_TIMED_DURATION_MINUTES);

        const visualStartMinute = Math.max(dayStart, Math.min(dayEnd - 1, rawStart));
        const visualEndMinute = Math.max(visualStartMinute + 1, Math.min(dayEnd, rawEnd));

        return {
            ...dt,
            visualStartMinute,
            visualEndMinute,
        };
    }
}
