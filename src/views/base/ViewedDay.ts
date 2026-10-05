/**
 * The day a dated view looks at.
 *
 * A dated view (Timeline, Schedule, Calendar, MiniCalendar) holds the
 * transient `date`. Absent, the view follows today — it moves to the new day
 * when the visual day rolls; present, it stays on that day, across a day
 * change and a restart (S3). Where the view puts the day in what it draws is
 * its own (Timeline puts the past days before it; Calendar starts its grid
 * on it).
 */

import { DateUtils } from '../../utils/DateUtils';

/** The day looked at: the fixed `date`, or `today` when the view follows it. */
export function viewedDay(date: string | undefined, today: string): string {
    return date ?? today;
}

/** Whether the view follows today. */
export function followsToday(date: string | undefined): boolean {
    return date === undefined;
}

/** The patch that moves the day looked at by `n` days; it fixes the day. */
export function shiftedDay(date: string | undefined, today: string, n: number): { date: string } {
    return { date: DateUtils.addDays(viewedDay(date, today), n) };
}

/** The patch that follows today again (Now, Today). */
export function followToday(): { date: undefined } {
    return { date: undefined };
}
