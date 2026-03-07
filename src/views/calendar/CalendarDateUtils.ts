import { App, TFile } from 'obsidian';
import type { Task, DisplayTask } from '../../types';
import { isCompleteStatusChar } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';

/**
 * Shared calendar date utilities used by both CalendarView and MiniCalendarView.
 */

export function getTaskDateRange(
    task: DisplayTask,
    startHour: number
): { effectiveStart: string | null; effectiveEnd: string | null } {
    if (!task.effectiveStartDate) {
        return { effectiveStart: null, effectiveEnd: null };  // D type
    }

    if (task.effectiveStartTime) {
        const visualDate = DateUtils.getVisualStartDate(
            task.effectiveStartDate,
            task.effectiveStartTime,
            startHour
        );
        const isAllDay = DateUtils.isAllDayTask(
            task.effectiveStartDate,
            task.effectiveStartTime,
            task.effectiveEndDate,
            task.effectiveEndTime,
            startHour
        );

        if (isAllDay && task.effectiveEndDate && task.effectiveEndDate >= task.effectiveStartDate) {
            return { effectiveStart: task.effectiveStartDate, effectiveEnd: task.effectiveEndDate };
        }
        return { effectiveStart: visualDate, effectiveEnd: visualDate };
    }

    const effectiveEnd = task.effectiveEndDate && task.effectiveEndDate >= task.effectiveStartDate
        ? task.effectiveEndDate
        : task.effectiveStartDate;
    return { effectiveStart: task.effectiveStartDate, effectiveEnd };
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
