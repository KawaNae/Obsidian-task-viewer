/**
 * Next-task suggestion (idle) for the widget.
 *
 * When no timer is running the widget shows the suggestion after its timers
 * (`TimerBoard.idle`, not a timer of its own); this module
 * picks the single task the user most likely wants to start next:
 *   1. 'current'  — an incomplete timed task whose window contains now
 *                   (latest start wins; ties broken by earliest end)
 *   2. 'upcoming' — the incomplete timed task starting soonest later in
 *                   the current visual day
 * All-day tasks (>= 23.5h, the codebase-wide boundary) are excluded — they
 * are day-long containers, not "the thing to do right now". Read-only tasks
 * are excluded too: the timer cannot write a record to them, so suggesting
 * one hands the user a session that will be lost.
 *
 * Results are cached per (index revision, wall-clock minute) so the
 * widget's 1-second tick never rescans the index.
 */

import type { PluginContext } from '../PluginContext';
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

    constructor(private plugin: PluginContext) {}

    getSuggestion(): NextTaskSuggestion | null {
        const revision = this.plugin.getIndex().getRevision();
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
        const startHour = this.plugin.settings.startHour;
        const defs = this.plugin.settings.statusDefinitions;

        const now = new Date();
        const nowTime = DateUtils.formatHHMM(now.getHours(), now.getMinutes());
        const nowStamp = `${DateUtils.getLocalDateString(now)}T${nowTime}`;
        const visualToday = DateUtils.getVisualDateOfNow(startHour);

        let current: DisplayTask | null = null;
        let currentStart = '';
        let currentEnd = '';
        let upcoming: DisplayTask | null = null;
        let upcomingStart = '';

        for (const dt of readService.getVisibleDisplayTasks()) {
            // 読み取り専用の記法（day-planner / tasks-plugin）にはタイマーの記録を
            // 書き込めない。提案から開始すると計測した分がそのまま消えるので、
            // カードメニューと同じ規則で候補から外す。
            if (dt.isReadOnly) continue;
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
