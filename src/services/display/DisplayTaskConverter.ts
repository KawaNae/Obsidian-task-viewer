import type { Task, DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { dayStart, visualDaysOf } from '../../utils/DayWindow';
import { isAllDay } from './SectionClassifier';
import { makeSegmentId } from './SegmentIds';
import { buildChildEntries } from '../data/ChildEntryBuilder';
import { resolveSpan, statedDates } from '../../utils/TaskDates';

/** Lookup signature for resolving sibling tasks during ChildEntry materialization. */
export type TaskLookup = (id: string) => Task | undefined;

/** No-op lookup for synthetic temp tasks that have no children. */
export const NO_TASK_LOOKUP: TaskLookup = () => undefined;

/**
 * Get the original (pre-split) task ID.
 *
 * Accepts both raw Task and DisplayTask via structural typing: a raw Task
 * has no `originalTaskId` so it falls through to `id`; a DisplayTask carries
 * `originalTaskId` (equal to `id` for non-split, the parent id for split
 * segments).
 */
export function getOriginalTaskId(task: { id: string; originalTaskId?: string }): string {
    return task.originalTaskId ?? task.id;
}

/**
 * Converts raw Task objects into DisplayTask with the dates the note states
 * (`statedDates`), the span and the due as moments (`resolveSpan`) and
 * materialized {@link ChildEntry} list.
 *
 * `getTask` resolves sibling tasks for child-entry partitioning. Pass
 * {@link NO_TASK_LOOKUP} for synthetic temp tasks that have no children
 * (modal placeholders, drag previews, etc.).
 */
export function toDisplayTask(task: Task, startHour: number, getTask: TaskLookup): DisplayTask {
    const stated = statedDates(task);
    const { span, dueMs } = resolveSpan(stated, startHour);
    return {
        ...task,
        stated,
        span,
        dueMs,
        drawn: span,
        originalTaskId: task.id,
        isSplit: false,
        childEntries: buildChildEntries(task, getTask),
    };
}

/** Batch convert tasks to DisplayTask (no split). */
export function toDisplayTasks(tasks: Task[], startHour: number, getTask: TaskLookup): DisplayTask[] {
    return tasks.map(t => toDisplayTask(t, startHour, getTask));
}

/**
 * A drag's edits in visual days: the first and the last visual day a task is
 * drawn over (`visualDaysOf`), and the times on them. Pass only the fields
 * that change; absent fields are not touched.
 */
export interface DisplayDateEdits {
    /** The visual day the task starts on. */
    startDay?: string;
    startTime?: string;
    /** The last visual day the task is drawn on (inclusive). */
    endDay?: string;
    endTime?: string;
}

/**
 * Inverse of `DayWindow.visualDayAt`. Given a visual date and the time at
 * that visual day, returns the underlying raw calendar date: a time before
 * `startHour` is on the next calendar date.
 */
function unshiftVisual(visualDate: string, time: string | undefined, startHour: number): string {
    if (!time) return visualDate;
    const h = Number(time.split(':')[0]);
    return Number.isFinite(h) && h < startHour
        ? DateUtils.addDays(visualDate, 1)
        : visualDate;
}

/**
 * Convert a drag's edits in visual days to a raw `Partial<Task>` update: the
 * single boundary between the drag and resize layer (which thinks in the
 * visual days `visualDaysOf` gives) and the line's dates.
 *
 * A side is written on the visual day it is on: a bare date as that day (a
 * bare end date is the end of the day it names, so the last day drawn is the
 * date written), a time before `startHour` on the next calendar date.
 * `baseTask` gives the time a side keeps when the edit does not change it.
 */
export function materializeRawDates(
    edits: DisplayDateEdits,
    baseTask: Task,
    startHour: number,
): Partial<Task> {
    const updates: Partial<Task> = {};

    if (edits.startDay !== undefined) {
        const time = edits.startTime !== undefined
            ? edits.startTime
            : baseTask.startTime;
        updates.startDate = unshiftVisual(edits.startDay, time, startHour);
    }
    if (edits.startTime !== undefined) {
        updates.startTime = edits.startTime;
    }

    if (edits.endDay !== undefined) {
        const time = edits.endTime !== undefined
            ? edits.endTime
            : baseTask.endTime;
        updates.endDate = unshiftVisual(edits.endDay, time, startHour);
    }
    if (edits.endTime !== undefined) {
        updates.endTime = edits.endTime;
    }

    return updates;
}

/**
 * Returns true when a timed DisplayTask is drawn over two visual days and
 * should be split at the boundary between them. An all-day task spans its
 * days by design and is never split.
 */
export function shouldSplitDisplayTask(dt: DisplayTask, startHour: number): boolean {
    if (!dt.drawn || isAllDay(dt)) return false;
    const { first, last } = visualDaysOf(dt.drawn, startHour);
    return first !== last;
}

/**
 * Splits a DisplayTask into two segments at the start of the visual day
 * after the one it starts on. Each segment is drawn over its part
 * (`drawn`); its line's values, `stated` and `span` are the whole task's.
 */
export function splitDisplayTaskAtBoundary(dt: DisplayTask, startHour: number): [DisplayTask, DisplayTask] {
    if (!dt.drawn) throw new Error('DisplayTask must have a span to split');
    const first = visualDaysOf(dt.drawn, startHour).first;
    const next = DateUtils.addDays(first, 1);
    const boundaryMs = dayStart(next, startHour);

    const headSegment: DisplayTask = {
        ...dt,
        id: makeSegmentId(dt.originalTaskId, first),
        isSplit: true,
        splitContinuesBefore: dt.splitContinuesBefore ?? false,
        splitContinuesAfter: true,
        drawn: { startMs: dt.drawn.startMs, endMs: boundaryMs },
    };

    const tailSegment: DisplayTask = {
        ...dt,
        id: makeSegmentId(dt.originalTaskId, next),
        isSplit: true,
        splitContinuesBefore: true,
        splitContinuesAfter: dt.splitContinuesAfter ?? false,
        drawn: { startMs: boundaryMs, endMs: dt.drawn.endMs },
    };

    return [headSegment, tailSegment];
}
