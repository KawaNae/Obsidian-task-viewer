import { DateUtils } from '../../utils/DateUtils';

/**
 * Shared calendar date utilities used by both CalendarView and MiniCalendarView.
 */

export function getCalendarDateRange(
    windowStart: string,
    weekStartDay: 0 | 1
): { startDate: Date; endDate: Date } {
    const parsedStart = DateUtils.readDate(windowStart);
    const fallbackStart = DateUtils.getWeekStart(new Date(), weekStartDay);
    const startDate = DateUtils.getWeekStart(parsedStart ?? fallbackStart, weekStartDay);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 41);
    return { startDate, endDate };
}

export function getNormalizedWindowStart(value: string, weekStartDay: 0 | 1): string {
    const parsed = DateUtils.readDate(value);
    const baseCalendarDate = parsed ?? new Date();
    const weekStart = DateUtils.getWeekStart(baseCalendarDate, weekStartDay);
    return DateUtils.getLocalDateString(weekStart);
}

export function getReferenceMonth(windowStart: string): { year: number; month: number } {
    const midDate = DateUtils.readDate(DateUtils.addDays(windowStart, 20));
    const fallback = DateUtils.readDate(windowStart) ?? new Date();
    const date = midDate ?? fallback;
    return { year: date.getFullYear(), month: date.getMonth() };
}

export function getColumnOffset(showWeekNumbers: boolean): number {
    return showWeekNumbers ? 1 : 0;
}

export function getGridColumnForDay(dayColumn: number, showWeekNumbers: boolean): number {
    return dayColumn + getColumnOffset(showWeekNumbers);
}
