/**
 * The six weeks Calendar and MiniCalendar draw, derived from the day they
 * look at.
 *
 * The view holds the transient `date` (`ViewedDay`). Absent, it follows
 * today and draws today's month grid: the six weeks from the week of the
 * month's 1st. Present, `date`'s week is the grid's top row. The week is
 * read with the week start of the settings each time, so a change of the
 * week start shows at once.
 *
 * Go to a day shows that day's month grid; the week arrows move the grid a
 * week at a time (stage9b-design, 設計から外れた所 1). Both fix the date to
 * the grid's new first day. Today clears it (`followToday`).
 */

import { DateUtils } from '../../utils/DateUtils';
import { followsToday } from '../base/ViewedDay';

export type WeekStartDay = 0 | 1;

/** The days the grid holds: six weeks. */
export const GRID_DAYS = 42;

/** The first day of the week `day` is in. */
export function weekStartOf(day: string, weekStartDay: WeekStartDay): string {
    return DateUtils.getLocalDateString(DateUtils.getWeekStart(DateUtils.parseDate(day), weekStartDay));
}

/** The first day of the month grid of `day`: the week start of its month's 1st. */
export function monthGridStartOf(day: string, weekStartDay: WeekStartDay): string {
    return DateUtils.getMonthGridStart(DateUtils.parseDate(day), weekStartDay);
}

/**
 * The grid's first day: the week of `date`, or, while the view follows
 * today, the start of today's month grid.
 */
export function gridStart(date: string | undefined, today: string, weekStartDay: WeekStartDay): string {
    return followsToday(date)
        ? monthGridStartOf(today, weekStartDay)
        : weekStartOf(date as string, weekStartDay);
}

/** The grid's last day. */
export function gridEnd(start: string): string {
    return DateUtils.addDays(start, GRID_DAYS - 1);
}

/** The patch that shows the month grid of `day` (Go to date). */
export function gridOfMonth(day: string, weekStartDay: WeekStartDay): { date: string } {
    return { date: monthGridStartOf(day, weekStartDay) };
}

/** The patch that moves the grid drawn by `weeks` weeks (the arrows, the wheel). */
export function gridShifted(
    date: string | undefined,
    today: string,
    weekStartDay: WeekStartDay,
    weeks: number,
): { date: string } {
    return { date: DateUtils.addDays(gridStart(date, today, weekStartDay), weeks * 7) };
}

/**
 * The month the grid starting at `start` is read as: the month of its
 * middle, the one its toolbar names and outside of which a cell is dimmed.
 */
export function referenceMonth(start: string): { year: number; month: number } {
    const mid = DateUtils.parseDate(DateUtils.addDays(start, 20));
    return { year: mid.getFullYear(), month: mid.getMonth() };
}

/** The day the date picker opens on: the 1st of the reference month. */
export function pickerDay(start: string): string {
    const { year, month } = referenceMonth(start);
    return DateUtils.getLocalDateString(DateUtils.dateAt(year, month, 1));
}
