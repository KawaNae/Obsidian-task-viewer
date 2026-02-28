import { App, TFile } from 'obsidian';
import type { Task } from '../../types';
import { isCompleteStatusChar } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';

/**
 * Shared calendar date utilities used by both CalendarView and MiniCalendarView.
 */

export function getTaskDateRange(
    task: Task,
    startHour: number
): { effectiveStart: string | null; effectiveEnd: string | null } {
    if (!task.startDate) {
        return { effectiveStart: null, effectiveEnd: null };
    }

    if (task.startTime) {
        const visualDate = DateUtils.getVisualStartDate(
            task.startDate,
            task.startTime,
            startHour
        );
        const isAllDay = DateUtils.isAllDayTask(
            task.startDate,
            task.startTime,
            task.endDate,
            task.endTime,
            startHour
        );

        if (isAllDay && task.endDate && task.endDate >= task.startDate) {
            return { effectiveStart: task.startDate, effectiveEnd: task.endDate };
        }
        return { effectiveStart: visualDate, effectiveEnd: visualDate };
    }

    const effectiveEnd = task.endDate && task.endDate >= task.startDate
        ? task.endDate
        : task.startDate;
    return { effectiveStart: task.startDate, effectiveEnd };
}

export function isTaskCompleted(
    task: Task,
    completeStatusChars: string[]
): boolean {
    let completed = isCompleteStatusChar(task.statusChar || ' ', completeStatusChars);
    if (!completed || task.childLines.length === 0) {
        return completed;
    }

    for (const childLine of task.childLines) {
        const match = childLine.match(/^\s*-\s*\[(.)\]/);
        if (match && !isCompleteStatusChar(match[1], completeStatusChars)) {
            completed = false;
            break;
        }
    }

    return completed;
}

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

export function getWeekStart(date: Date, weekStartDay: 0 | 1): Date {
    const day = date.getDay();
    const diff = (day - weekStartDay + 7) % 7;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff);
}

export function getNormalizedWindowStart(value: string, weekStartDay: 0 | 1): string {
    const parsed = parseLocalDateString(value);
    const baseDate = parsed ?? new Date();
    const weekStart = getWeekStart(baseDate, weekStartDay);
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
