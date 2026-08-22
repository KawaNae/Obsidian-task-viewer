import { DateUtils } from '../../utils/DateUtils';

/**
 * A visual day boundary, and the minute on either side of it.
 *
 * Splitting a task at a day boundary needs both: the tail starts on the
 * boundary, and the head ends on the last minute before it. The two are one
 * minute apart, which for most `startHour` values means the same calendar
 * date — but at `startHour = 0` the minute before midnight belongs to the
 * previous date, and that rollover is the whole reason this lives in one
 * function.
 *
 * Both split paths (DisplayTaskConverter for visual-date splits, TaskSplitter
 * for date-range clipping) took the time from a `startHour === 0` special
 * case and the date from the boundary, so at midnight the head ended a day
 * late. A head an extra day long reads as 24 hours, which the section
 * classifier calls an all-day task, and the timeline drops it (see
 * DayBoundary.test.ts).
 */
export interface DayBoundary {
    /** The boundary itself: `startHour:00` on the boundary date. */
    date: string;
    time: string;
    /** The last minute before the boundary. */
    beforeDate: string;
    beforeTime: string;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * The boundary that opens `boundaryDate`'s visual day, and the minute before.
 *
 * The rollover is derived rather than written down: one minute before
 * `startHour:00` is a negative minute-of-day exactly when `startHour` is 0,
 * which is exactly when the date has to step back. Deriving it means the date
 * and the time cannot disagree, which is how they came to disagree before.
 */
export function dayBoundaryAt(boundaryDate: string, startHour: number): DayBoundary {
    const boundaryMinutes = startHour * 60;
    const beforeMinutes = boundaryMinutes - 1;

    return {
        date: boundaryDate,
        time: DateUtils.minutesToTime(boundaryMinutes),
        beforeDate: beforeMinutes < 0 ? DateUtils.addDays(boundaryDate, -1) : boundaryDate,
        beforeTime: DateUtils.minutesToTime((beforeMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY),
    };
}
