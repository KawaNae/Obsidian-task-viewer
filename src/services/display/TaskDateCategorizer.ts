import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { getTaskDateRange } from './VisualDateRange';
import {
    compareAllDayForRender,
    compareTimedForRender,
    compareDueOnlyForRender,
} from './TaskRenderOrder';

/**
 * 日付ごとのタスクバケツ。
 * 各バケツ (allDay / timed / dueOnly) は canonical render order でソート済みで返る:
 *   - allDay:  effectiveStartDate ASC, id ASC
 *   - timed:   effectiveStartTime ASC, id ASC
 *   - dueOnly: due ASC, id ASC
 * 消費者はこの順序を前提にしてよく、再ソートは不要。
 * この不変条件により、同一列内の `.task-card` DOM 兄弟順が決定論となり、
 * `position: absolute` 下の paint 順（document 順）も安定する。
 */
export interface CategorizedTasks {
    allDay: DisplayTask[];
    timed: DisplayTask[];
    dueOnly: DisplayTask[];
}

function sortBuckets(buckets: CategorizedTasks, startHour: number): void {
    buckets.allDay.sort(compareAllDayForRender);
    buckets.timed.sort((a, b) => compareTimedForRender(a, b, startHour));
    buckets.dueOnly.sort(compareDueOnlyForRender);
}

function emptyBuckets(): CategorizedTasks {
    return { allDay: [], timed: [], dueOnly: [] };
}

/**
 * Categorizes a single DisplayTask into the appropriate bucket for the given date.
 * Returns the category name, or null if the task does not belong to this date.
 */
function categorizeForDate(
    dt: DisplayTask,
    date: string,
    startHour: number
): keyof CategorizedTasks | null {
    // D type: no start/end dates, only due
    if (!dt.effectiveStartDate && !dt.startDate && !dt.endDate) {
        if (dt.due && dt.due.split('T')[0] === date) return 'dueOnly';
        return null;
    }

    if (!dt.effectiveStartDate) return null;

    // All-day check
    const isAllDay = DateUtils.isAllDayTask(
        dt.effectiveStartDate,
        dt.effectiveStartTime,
        dt.effectiveEndDate,
        dt.effectiveEndTime,
        startHour
    );

    if (isAllDay) {
        const taskEnd = dt.effectiveEndDate || dt.effectiveStartDate;
        if (dt.effectiveStartDate <= date && taskEnd >= date) return 'allDay';
        return null;
    }

    // Timed
    if (!dt.effectiveStartTime) return null;

    const range = getTaskDateRange(dt, startHour);
    const visualDate = range.effectiveStart || dt.effectiveStartDate;
    return visualDate === date ? 'timed' : null;
}

/** Single date: DisplayTask[] → 3 categories */
export function categorizeTasksForDate(
    tasks: DisplayTask[],
    date: string,
    startHour: number
): CategorizedTasks {
    const buckets = emptyBuckets();
    for (const dt of tasks) {
        const category = categorizeForDate(dt, date, startHour);
        if (category) buckets[category].push(dt);
    }
    sortBuckets(buckets, startHour);
    return buckets;
}

/** Multiple dates: DisplayTask[] → Map<date, CategorizedTasks> */
export function categorizeTasksByDate(
    tasks: DisplayTask[],
    dates: string[],
    startHour: number
): Map<string, CategorizedTasks> {
    const map = new Map<string, CategorizedTasks>();
    for (const date of dates) {
        map.set(date, emptyBuckets());
    }

    for (const dt of tasks) {
        // D type: belongs to at most one date (its due date)
        if (!dt.effectiveStartDate && !dt.startDate && !dt.endDate) {
            if (dt.due) {
                const dueDate = dt.due.split('T')[0];
                const bucket = map.get(dueDate);
                if (bucket) bucket.dueOnly.push(dt);
            }
            continue;
        }

        if (!dt.effectiveStartDate) continue;

        const isAllDay = DateUtils.isAllDayTask(
            dt.effectiveStartDate,
            dt.effectiveStartTime,
            dt.effectiveEndDate,
            dt.effectiveEndTime,
            startHour
        );

        if (isAllDay) {
            const taskEnd = dt.effectiveEndDate || dt.effectiveStartDate;
            for (const date of dates) {
                if (dt.effectiveStartDate <= date && taskEnd >= date) {
                    map.get(date)!.allDay.push(dt);
                }
            }
            continue;
        }

        if (!dt.effectiveStartTime) continue;

        const range = getTaskDateRange(dt, startHour);
        const visualDate = range.effectiveStart || dt.effectiveStartDate;
        const bucket = map.get(visualDate);
        if (bucket) bucket.timed.push(dt);
    }

    for (const buckets of map.values()) {
        sortBuckets(buckets, startHour);
    }

    return map;
}
