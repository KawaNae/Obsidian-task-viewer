/**
 * The columns of a calendar week row, shared by CalendarView and
 * MiniCalendarView. The days a grid holds are read in `CalendarGrid`.
 */

export function getColumnOffset(showWeekNumbers: boolean): number {
    return showWeekNumbers ? 1 : 0;
}

export function getGridColumnForDay(dayColumn: number, showWeekNumbers: boolean): number {
    return dayColumn + getColumnOffset(showWeekNumbers);
}
