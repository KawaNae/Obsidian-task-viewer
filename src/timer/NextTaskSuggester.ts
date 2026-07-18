/**
 * Next-task suggestion for the idle timer item.
 *
 * When all timers are closed the widget shows an idle timer; this module
 * picks the single task the user most likely wants to start next:
 *   1. 'current'  — an incomplete timed task whose window contains now
 *                   (latest start wins; ties broken by earliest end)
 *   2. 'upcoming' — the incomplete timed task starting soonest later in
 *                   the current visual day
 * All-day tasks (>= 23.5h, the codebase-wide boundary) are excluded — they
 * are day-long containers, not "the thing to do right now".
 *
 * Results are cached per (TaskIndex revision, wall-clock minute) so the
 * 1-second idle tick never rescans the index.
 */

import type TaskViewerPlugin from '../main';
import type { DisplayTask } from '../types';
import { DateUtils } from '../utils/DateUtils';
import { isTaskCompleted } from '../services/display/TaskStatusQuery';

export type NextTaskKind = 'current' | 'upcoming';

export interface NextTaskSuggestion {
    task: DisplayTask;
    kind: NextTaskKind;
}

/** Stable identity for change detection in the renderer. */
export function suggestionKey(s: NextTaskSuggestion | null): string {
    return s ? `${s.kind}:${s.task.id}` : '';
}

export class NextTaskSuggester {
    private cached: NextTaskSuggestion | null = null;
    private cacheRevision = -1;
    private cacheMinute = -1;

    constructor(private plugin: TaskViewerPlugin) {}

    getSuggestion(): NextTaskSuggestion | null {
        const revision = this.plugin.getTaskIndex().getRevision();
        const minute = Math.floor(Date.now() / 60_000);
        if (revision === this.cacheRevision && minute === this.cacheMinute) {
            return this.cached;
        }
        this.cacheRevision = revision;
        this.cacheMinute = minute;
        this.cached = this.compute();
        return this.cached;
    }

    private compute(): NextTaskSuggestion | null {
        const readService = this.plugin.getTaskReadService();
        const startHour = readService.getStartHour();
        const defs = this.plugin.settings.statusDefinitions;

        const now = new Date();
        const nowTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const nowStamp = `${DateUtils.getLocalDateString(now)}T${nowTime}`;
        const visualToday = DateUtils.getVisualDateOfNow(startHour);

        let current: DisplayTask | null = null;
        let currentStart = '';
        let currentEnd = '';
        let upcoming: DisplayTask | null = null;
        let upcomingStart = '';

        for (const dt of readService.getAllDisplayTasks()) {
            if (!dt.effectiveStartDate || !dt.effectiveStartTime) continue;
            if (DateUtils.isAllDayTask(
                dt.effectiveStartDate, dt.effectiveStartTime,
                dt.effectiveEndDate, dt.effectiveEndTime, startHour
            )) continue;

            const startStamp = `${dt.effectiveStartDate}T${dt.effectiveStartTime}`;
            const endStamp = dt.effectiveEndDate
                ? `${dt.effectiveEndDate}T${dt.effectiveEndTime ?? '23:59'}`
                : startStamp;

            if (startStamp <= nowStamp && nowStamp < endStamp) {
                if (isTaskCompleted(dt, defs, readService)) continue;
                if (!current
                    || startStamp > currentStart
                    || (startStamp === currentStart && endStamp < currentEnd)) {
                    current = dt;
                    currentStart = startStamp;
                    currentEnd = endStamp;
                }
            } else if (startStamp > nowStamp) {
                const visualStart = DateUtils.toVisualDate(
                    dt.effectiveStartDate, dt.effectiveStartTime, startHour
                );
                if (visualStart !== visualToday) continue;
                if (isTaskCompleted(dt, defs, readService)) continue;
                if (!upcoming || startStamp < upcomingStart) {
                    upcoming = dt;
                    upcomingStart = startStamp;
                }
            }
        }

        if (current) return { task: current, kind: 'current' };
        if (upcoming) return { task: upcoming, kind: 'upcoming' };
        return null;
    }
}
