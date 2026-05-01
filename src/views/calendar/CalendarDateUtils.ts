import { App, TFile } from 'obsidian';
import type { StatusDefinition, Task, DisplayTask } from '../../types';
import { isCompleteStatusChar } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import type { TaskReadService } from '../../services/data/TaskReadService';

/**
 * Shared calendar date utilities used by both CalendarView and MiniCalendarView.
 */

// Canonical implementation lives in services/display/VisualDateRange.ts
export { getTaskDateRange } from '../../services/display/VisualDateRange';

/**
 * A task is complete iff its own status char is complete AND every child
 * entry resolves to a complete status. Child entries cover both inline
 * checkbox lines (`plain` kind) and child tasks (`task`/`wikilink` kinds),
 * so child task status now factors into the calendar completion indicator
 * — earlier the check only looked at the parent's own checkbox lines.
 */
export function isTaskCompleted(
    task: DisplayTask,
    completeStatusChars: StatusDefinition[],
    readService: TaskReadService,
): boolean {
    let completed = isCompleteStatusChar(task.statusChar || ' ', completeStatusChars);
    if (!completed || task.childEntries.length === 0) {
        return completed;
    }

    for (const entry of task.childEntries) {
        if (entry.kind === 'plain') {
            const ch = entry.line.checkboxChar;
            if (ch !== null && !isCompleteStatusChar(ch, completeStatusChars)) return false;
        } else {
            const childId = entry.kind === 'task' ? entry.taskId : null;
            const child = childId ? readService.getTask(childId) : undefined;
            if (!child) continue;
            if (!isCompleteStatusChar(child.statusChar || ' ', completeStatusChars)) return false;
        }
    }

    return true;
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
