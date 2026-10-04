import type { DisplayTask } from '../../types';
import { visualDaysOf } from '../../utils/DayWindow';
import { classifyForSection, type Section } from './SectionClassifier';
import { compareAllDayForRender, compareTimedForRender } from './TaskRenderOrder';

/**
 * 日付ごとのタスクバケツ。キー集合は SectionKind（null 除く）と型で一致する。
 * 各バケツ (allDay / timed) は canonical render order でソート済みで返る:
 *   - allDay:  the start of what is drawn ASC
 *   - timed:   visual start ASC, duration DESC
 * 同順位はファイル、行番号の順（TaskRenderOrder）。
 * 消費者はこの順序を前提にしてよく、再ソートは不要。
 * この不変条件により、同一列内の `.task-card` DOM 兄弟順が決定論となり、
 * `position: absolute` 下の paint 順（document 順）も安定する。
 */
export type CategorizedTasks = Record<Section, DisplayTask[]>;

function sortBuckets(buckets: CategorizedTasks, startHour: number): void {
    buckets.allDay.sort(compareAllDayForRender);
    buckets.timed.sort((a, b) => compareTimedForRender(a, b, startHour));
}

function emptyBuckets(): CategorizedTasks {
    return { allDay: [], timed: [] };
}

/**
 * Placement of a task: its section kind plus the date span it belongs to.
 *
 * The kind decision tree lives in classifyForSection (single source of
 * truth); this module only owns the per-kind date membership rules (a task
 * with only a due has the span read from its due, so it is one of these):
 *   - allDay:  the visual days it is drawn over (`visualDaysOf(drawn)`) —
 *              the same function the AllDay lane uses for card spans, so
 *              bucket membership and lane rendering agree by construction
 *   - timed:   the visual day it is drawn from
 */
type TaskPlacement =
    | { kind: 'allDay'; visualStart: string; visualEnd: string }
    | { kind: 'timed'; visualDate: string }
    | null;

function placeTask(dt: DisplayTask, startHour: number): TaskPlacement {
    const kind = classifyForSection(dt);
    if (!kind || !dt.drawn) return null;
    const { first, last } = visualDaysOf(dt.drawn, startHour);
    return kind === 'allDay'
        ? { kind, visualStart: first, visualEnd: last }
        : { kind, visualDate: first };
}

function belongsToDate(placement: NonNullable<TaskPlacement>, date: string): boolean {
    switch (placement.kind) {
        case 'allDay': return placement.visualStart <= date && placement.visualEnd >= date;
        case 'timed': return placement.visualDate === date;
    }
}

/** Single date: DisplayTask[] → the all-day and the timed buckets */
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
