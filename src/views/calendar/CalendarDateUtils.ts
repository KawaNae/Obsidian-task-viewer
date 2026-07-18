import type { App, TFile } from 'obsidian';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';

/**
 * Shared calendar date utilities used by both CalendarView and MiniCalendarView.
 */

// Canonical implementation lives in services/display/VisualDateRange.ts
export { getTaskDateRange } from '../../services/display/VisualDateRange';

// Canonical implementation lives in services/display/TaskStatusQuery.ts
export { isTaskCompleted } from '../../services/display/TaskStatusQuery';

export function parseLocalDateString(value: string): Date | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }

    const parsed = new Date(year, month - 1, day);
    if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
    ) {
        return null;
    }

    return parsed;
}

export function getCalendarDateRange(
    windowStart: string,
    weekStartDay: 0 | 1
): { startDate: Date; endDate: Date } {
    const parsedStart = parseLocalDateString(windowStart);
    const fallbackStart = getWeekStart(new Date(), weekStartDay);
    const startDate = getWeekStart(parsedStart ?? fallbackStart, weekStartDay);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 41);
    return { startDate, endDate };
}

export const getWeekStart = DateUtils.getWeekStart;

export function getNormalizedWindowStart(value: string, weekStartDay: 0 | 1): string {
    const parsed = parseLocalDateString(value);
    const baseCalendarDate = parsed ?? new Date();
    const weekStart = getWeekStart(baseCalendarDate, weekStartDay);
    return DateUtils.getLocalDateString(weekStart);
}

export function getReferenceMonth(windowStart: string): { year: number; month: number } {
    const midDate = parseLocalDateString(DateUtils.addDays(windowStart, 20));
    const fallback = parseLocalDateString(windowStart) ?? new Date();
    const date = midDate ?? fallback;
    return { year: date.getFullYear(), month: date.getMonth() };
}

export function getColumnOffset(showWeekNumbers: boolean): number {
    return showWeekNumbers ? 1 : 0;
}

export function getGridColumnForDay(dayColumn: number, showWeekNumbers: boolean): number {
    return dayColumn + getColumnOffset(showWeekNumbers);
}

export async function openOrCreateDailyNote(app: App, date: Date): Promise<void> {
    let file: TFile | null = DailyNoteUtils.getDailyNote(app, date);
    if (!file) {
        file = await DailyNoteUtils.createDailyNote(app, date);
    }
    if (file) {
        await app.workspace.getLeaf(false).openFile(file);
    }
}
