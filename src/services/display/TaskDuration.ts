import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

/**
 * How long a task lasts: from its effective start (date and time) to its
 * effective end. null for a task without a start (due only), or whose end
 * comes before its start.
 *
 * The filter's `length` and the API's `durationMinutes` both read this, so a
 * task that `length greaterThan 24 hours` picks up reports the same span.
 * The API used to subtract the times of day alone, so a task from
 * 2026-01-01T10:00 to 2026-01-03T11:00 came out as 60 minutes.
 */
export function getDisplayTaskDurationMs(task: DisplayTask, startHour: number): number | null {
    if (!task.effectiveStartDate) return null;
    const ms = DateUtils.getTaskDurationMs(
        task.effectiveStartDate, task.effectiveStartTime,
        task.effectiveEndDate, task.effectiveEndTime,
        startHour,
    );
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
