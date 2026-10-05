/**
 * The six weeks Calendar and MiniCalendar draw, derived from where the view
 * is.
 *
 * The view holds two transient fields. `date` is the day it looks at, as in
 * every dated view (`ViewedDay`): absent, the view follows today. `weekOffset`
 * is how many weeks the grid was moved from `date`'s month grid (absent: 0).
 * The grid's top row is the week of the 1st of `date`'s month, moved by
 * `weekOffset` weeks. The week is read with the week start of the settings
 * each time, so a change of the week start shows at once and never moves a
 * month grid off its month.
 *
 * Go to a day (the picker, a URI, the CLI) puts the day in `date` and clears
 * the offset; the arrows and the wheel move only the offset, fixing today in
 * `date` when the view follows it; Today clears both.
 */

import { DateUtils } from '../../utils/DateUtils';
import { followToday, viewedDay } from '../base/ViewedDay';

export type WeekStartDay = 0 | 1;

/** The days the grid holds: six weeks. */
export const GRID_DAYS = 42;

/** Where a Calendar or a MiniCalendar is: its two transient fields. */
export interface GridPosition {
    date?: string;
    weekOffset?: number;
}

/** The first day of the week `day` is in. */
export function weekStartOf(day: string, weekStartDay: WeekStartDay): string {
    return DateUtils.getLocalDateString(DateUtils.getWeekStart(DateUtils.parseDate(day), weekStartDay));
}

/**
 * The days the grid draws, first and last: from the week of the 1st of the
 * day looked at's month (today while the view follows it), moved by the
 * offset, six weeks.
 */
export function gridRange(
    position: GridPosition,
    today: string,
    weekStartDay: WeekStartDay,
): { start: string; end: string } {
    const monthGridStart = DateUtils.getMonthGridStart(DateUtils.parseDate(viewedDay(position.date, today)), weekStartDay);
    const start = DateUtils.addDays(monthGridStart, 7 * (position.weekOffset ?? 0));
    return { start, end: DateUtils.addDays(start, GRID_DAYS - 1) };
}

/** An offset as it is held: 0 is absent. */
function heldOffset(weeks: number): number | undefined {
    return weeks === 0 ? undefined : weeks;
}

/** The patch that shows the month grid of `day` (Go to date): the day fixed, no offset. */
export function gridAt(day: string): { date: string; weekOffset: undefined } {
    return { date: day, weekOffset: undefined };
}

/**
 * The patch that moves the grid by `weeks` weeks (the arrows, the wheel):
 * only the offset moves. A view that follows today fixes today first, so the
 * grid it moves from is the one it showed.
 */
export function gridShifted(
    position: GridPosition,
    today: string,
    weeks: number,
): { date: string; weekOffset: number | undefined } {
    return {
        date: viewedDay(position.date, today),
        weekOffset: heldOffset((position.weekOffset ?? 0) + weeks),
    };
}

/** The patch that follows today again (Today): the date and the offset cleared. */
export function gridFollowingToday(): { date: undefined; weekOffset: undefined } {
    return { ...followToday(), weekOffset: undefined };
}

/**
 * The month the grid starting at `start` is read as: the month of its
 * middle, the one its toolbar names and outside of which a cell is dimmed.
 * With no offset this is the month of the day looked at (the middle of a
 * month grid lies between the month's 15th and 21st).
 */
export function referenceMonth(start: string): { year: number; month: number } {
    const mid = DateUtils.parseDate(DateUtils.addDays(start, 20));
    return { year: mid.getFullYear(), month: mid.getMonth() };
}
