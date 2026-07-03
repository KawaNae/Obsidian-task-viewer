import type { DisplayTask } from '../../types';
import { getTaskDateRange } from './VisualDateRange';
import { classifyForSection, type Section } from './SectionClassifier';
import {
    compareAllDayForRender,
    compareTimedForRender,
    compareDueOnlyForRender,
} from './TaskRenderOrder';

/**
 * 日付ごとのタスクバケツ。キー集合は SectionKind（null 除く）と型で一致する。
 * 各バケツ (allDay / timed / dueOnly) は canonical render order でソート済みで返る:
 *   - allDay:  effectiveStartDate ASC, id ASC
 *   - timed:   effectiveStartTime ASC, id ASC
 *   - dueOnly: due ASC, id ASC
 * 消費者はこの順序を前提にしてよく、再ソートは不要。
 * この不変条件により、同一列内の `.task-card` DOM 兄弟順が決定論となり、
 * `position: absolute` 下の paint 順（document 順）も安定する。
 */
export type CategorizedTasks = Record<Section, DisplayTask[]>;

function sortBuckets(buckets: CategorizedTasks, startHour: number): void {
    buckets.allDay.sort(compareAllDayForRender);
    buckets.timed.sort((a, b) => compareTimedForRender(a, b, startHour));
    buckets.dueOnly.sort(compareDueOnlyForRender);
}

function emptyBuckets(): CategorizedTasks {
    return { allDay: [], timed: [], dueOnly: [] };
}

/**
 * Placement of a task: its section kind plus the date span it belongs to.
 *
 * The kind decision tree lives in classifyForSection (single source of
 * truth); this module only owns the per-kind date membership rules:
 *   - dueOnly: calendar date of the raw due (deadline = calendarDate semantics)
 *   - allDay:  inclusive visual range from getTaskDateRange — the same
 *              function the AllDay lane uses for card spans, so bucket
 *              membership and lane rendering agree by construction
 *              (an inverted effective range is clamped to a single day)
 *   - timed:   the task's visual date (startHour-adjusted)
 */
type TaskPlacement =
    | { kind: 'allDay'; visualStart: string; visualEnd: string }
    | { kind: 'timed'; visualDate: string }
    | { kind: 'dueOnly'; dueDate: string }
    | null;

function placeTask(dt: DisplayTask, startHour: number): TaskPlacement {
    const kind = classifyForSection(dt, startHour);
    switch (kind) {
        case 'dueOnly':
            return { kind, dueDate: (dt.due ?? '').split('T')[0] };
        case 'allDay': {
            const range = getTaskDateRange(dt, startHour);
            const visualStart = range.effectiveStart || dt.effectiveStartDate;
            return { kind, visualStart, visualEnd: range.effectiveEnd || visualStart };
        }
        case 'timed': {
            const range = getTaskDateRange(dt, startHour);
            return { kind, visualDate: range.effectiveStart || dt.effectiveStartDate };
        }
        default:
            return null;
    }
}

function belongsToDate(placement: NonNullable<TaskPlacement>, date: string): boolean {
    switch (placement.kind) {
        case 'dueOnly': return placement.dueDate === date;
        case 'allDay': return placement.visualStart <= date && placement.visualEnd >= date;
        case 'timed': return placement.visualDate === date;
    }
}

/** Single date: DisplayTask[] → 3 categories */
export function categorizeTasksForDate(
    tasks: DisplayTask[],
    date: string,
    startHour: number
): CategorizedTasks {
    const buckets = emptyBuckets();
    for (const dt of tasks) {
        const placement = placeTask(dt, startHour);
        if (placement && belongsToDate(placement, date)) {
            buckets[placement.kind].push(dt);
        }
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
        const placement = placeTask(dt, startHour);
        if (!placement) continue;
        switch (placement.kind) {
            case 'dueOnly':
                map.get(placement.dueDate)?.dueOnly.push(dt);
                break;
            case 'timed':
                map.get(placement.visualDate)?.timed.push(dt);
                break;
            case 'allDay':
                for (const date of dates) {
                    if (belongsToDate(placement, date)) {
                        map.get(date)!.allDay.push(dt);
                    }
                }
                break;
        }
    }

    for (const buckets of map.values()) {
        sortBuckets(buckets, startHour);
    }

    return map;
}
