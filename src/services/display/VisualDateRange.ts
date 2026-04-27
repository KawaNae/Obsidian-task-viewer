import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

/**
 * Computes the inclusive visual date range for a DisplayTask.
 * This is the canonical function for converting effective dates to visual dates
 * (adjusted for startHour boundary). All code needing visual date ranges should
 * use this function rather than calling DateUtils.toVisualDate directly.
 *
 * Exceptions: DisplayTaskConverter (builds DisplayTask, can't consume it) and
 * TaskIndex split-segment boundary computation (dynamic boundary time).
 */
export function getTaskDateRange(
    task: DisplayTask,
    startHour: number
): { effectiveStart: string | null; effectiveEnd: string | null } {
    if (!task.effectiveStartDate) {
        return { effectiveStart: null, effectiveEnd: null };  // D type
    }

    const visualStart = task.effectiveStartTime
        ? DateUtils.toVisualDate(task.effectiveStartDate, task.effectiveStartTime, startHour)
        : task.effectiveStartDate;

    if (task.effectiveEndDate && task.effectiveEndDate >= task.effectiveStartDate) {
        const visualEnd = DateUtils.toVisualDate(
            task.effectiveEndDate, task.effectiveEndTime, startHour
        );
        return {
            effectiveStart: visualStart,
            effectiveEnd: visualEnd >= visualStart ? visualEnd : visualStart,
        };
    }

    return { effectiveStart: visualStart, effectiveEnd: visualStart };
}

/**
 * True when a DisplayTask is rendered as an all-day card
 * (no startTime, or duration ≥ 23h30m).
 */
export function isTaskAllDay(task: DisplayTask, startHour: number): boolean {
    return DateUtils.isAllDayTask(
        task.effectiveStartDate,
        task.effectiveStartTime,
        task.effectiveEndDate,
        task.effectiveEndTime,
        startHour
    );
}
