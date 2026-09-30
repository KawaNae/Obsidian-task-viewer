import type { Task, DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { dayBoundaryAt } from './DayBoundary';
import { makeSegmentId } from './SegmentIds';
import { buildChildEntries } from '../data/ChildEntryBuilder';
import { resolveEffectiveDates } from '../../utils/EffectiveDates';

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
 * Converts raw Task objects into DisplayTask with resolved effective fields
 * (`resolveEffectiveDates`) and materialized {@link ChildEntry} list.
 *
 * `getTask` resolves sibling tasks for child-entry partitioning. Pass
 * {@link NO_TASK_LOOKUP} for synthetic temp tasks that have no children
 * (modal placeholders, drag previews, etc.).
 */
export function toDisplayTask(task: Task, startHour: number, getTask: TaskLookup): DisplayTask {
    return {
        ...task,
        ...resolveEffectiveDates(task, startHour),
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
 * Inclusive visual edits to a DisplayTask, expressed in the same coordinate
 * system as `effective*` fields. Pass only the fields that change; absent
 * fields are not touched.
 */
export interface DisplayDateEdits {
    /** Inclusive visual start date (matches DisplayTask.effectiveStartDate). */
    effectiveStartDate?: string;
    effectiveStartTime?: string;
    /** Inclusive visual end date (matches DisplayTask.effectiveEndDate). */
    effectiveEndDate?: string;
    effectiveEndTime?: string;
}

/**
 * Inverse of `toVisualDate`. Given a visual date and the time at that visual
 * day, returns the underlying raw calendar date.
 *
 * `toVisualDate(date, time, startHour)` shifts -1 day when `time < startHour`,
 * so the inverse shifts +1 day in the same condition.
 */
function unshiftVisual(visualDate: string, time: string | undefined, startHour: number): string {
    if (!time) return visualDate;
    const h = Number(time.split(':')[0]);
    return Number.isFinite(h) && h < startHour
        ? DateUtils.addDays(visualDate, 1)
        : visualDate;
}

/**
 * Convert inclusive visual edits to a raw `Partial<Task>` update.
 *
 * This is the **single boundary** between drag/resize layer (which thinks in
 * inclusive visual dates, matching `DisplayTask.effective*`) and the raw Task
 * layer (where `endDate` is exclusive when `endTime` is absent and inclusive
 * when `endTime` is present — a dual semantic preserved for parser/writer
 * round-trip with the external @notation).
 *
 * `baseTask` provides the existing endTime to decide which semantic applies
 * to the raw `endDate` write. If `edits.effectiveEndTime` is also being
 * changed, the edit value wins (a drag that adds/removes endTime can flip the
 * semantic).
 *
 * Drag write-back must always go through this function. Direct
 * `addDays(visualEnd, 1)` in caller code is the bug pattern this helper
 * eliminates.
 */
export function materializeRawDates(
    edits: DisplayDateEdits,
    baseTask: Task,
    startHour: number,
): Partial<Task> {
    const updates: Partial<Task> = {};

    if (edits.effectiveStartDate !== undefined) {
        const time = edits.effectiveStartTime !== undefined
            ? edits.effectiveStartTime
            : baseTask.startTime;
        updates.startDate = unshiftVisual(edits.effectiveStartDate, time, startHour);
    }
    if (edits.effectiveStartTime !== undefined) {
        updates.startTime = edits.effectiveStartTime;
    }

    if (edits.effectiveEndDate !== undefined) {
        const willHaveEndTime = edits.effectiveEndTime !== undefined
            ? !!edits.effectiveEndTime
            : !!baseTask.endTime;
        if (willHaveEndTime) {
            const endTime = edits.effectiveEndTime !== undefined
                ? edits.effectiveEndTime
                : baseTask.endTime;
            updates.endDate = unshiftVisual(edits.effectiveEndDate, endTime, startHour);
        } else {
            // pure all-day: visual inclusive end → raw exclusive (+1)
            updates.endDate = DateUtils.addDays(edits.effectiveEndDate, 1);
        }
    }
    if (edits.effectiveEndTime !== undefined) {
        updates.endTime = edits.effectiveEndTime;
    }

    return updates;
}

/**
 * Returns true when a DisplayTask crosses the visual day boundary and should be split.
 * Uses effective values so E/ED types can also be split.
 */
export function shouldSplitDisplayTask(dt: DisplayTask, startHour: number): boolean {
    if (!dt.effectiveStartDate || !dt.effectiveEndDate || !dt.effectiveStartTime || !dt.effectiveEndTime) {
        return false;
    }

    // AllDay tasks (duration >= 23.5h) span multiple visual days by design — never split
    if (DateUtils.isAllDayTask(dt.effectiveStartDate, dt.effectiveStartTime, dt.effectiveEndDate, dt.effectiveEndTime, startHour)) {
        return false;
    }

    // Timed tasks: check if they cross a visual-date boundary
    const visualStartDay = DateUtils.toVisualDate(dt.effectiveStartDate, dt.effectiveStartTime, startHour);

    let visualEndDay = dt.effectiveEndDate;
    const [endH, endM] = dt.effectiveEndTime.split(':').map(Number);
    if (endH < startHour || (endH === startHour && endM === 0)) {
        visualEndDay = DateUtils.addDays(dt.effectiveEndDate, -1);
    }

    return visualStartDay !== visualEndDay;
}

/**
 * Splits a DisplayTask into two segments at the visual day boundary.
 * Overrides both raw and effective start/end fields for each segment.
 */
export function splitDisplayTaskAtBoundary(dt: DisplayTask, startHour: number): [DisplayTask, DisplayTask] {
    if (!dt.effectiveStartDate || !dt.effectiveEndDate || !dt.effectiveStartTime || !dt.effectiveEndTime) {
        throw new Error('DisplayTask must have effective start and end date/time to split');
    }

    let boundaryCalendarDate: string;
    if (dt.effectiveStartDate === dt.effectiveEndDate) {
        boundaryCalendarDate = dt.effectiveStartDate;
    } else {
        boundaryCalendarDate = DateUtils.addDays(dt.effectiveStartDate, 1);
    }

    // head の effective end は boundary の 1 分前。これにより `toVisualDate` が
    // head を前日に置き、tail の visual start day と重ならない。boundary 時刻
    // ちょうど ('05:00') を head end にすると toVisualDate (`h < startHour`) が
    // 当日扱いとなり tail と同日に重複し、GridTaskLayout の greedy track 割り当てで
    // 別 track に飛ぶバグを生む。日付と時刻を対で受け取るのは、両者がずれると
    // head が 1 日長くなり、23.5h 閾値を越えて allDay に誤分類されるため
    // (startHour=0 で実際に起きていた。dayBoundaryAt の doc を参照)。
    const boundary = dayBoundaryAt(boundaryCalendarDate, startHour);

    const beforeSegmentDate = DateUtils.toVisualDate(dt.effectiveStartDate, dt.effectiveStartTime, startHour);
    const afterSegmentDate = DateUtils.toVisualDate(boundary.date, boundary.time, startHour);

    const headSegment: DisplayTask = {
        ...dt,
        id: makeSegmentId(dt.originalTaskId, beforeSegmentDate),
        isSplit: true,
        splitContinuesBefore: dt.splitContinuesBefore ?? false,
        splitContinuesAfter: true,
        // Override both raw and effective end to boundary - 1min (前日 inclusive)
        endDate: boundary.beforeDate,
        endTime: boundary.beforeTime,
        effectiveEndDate: boundary.beforeDate,
        effectiveEndTime: boundary.beforeTime,
    };

    const tailSegment: DisplayTask = {
        ...dt,
        id: makeSegmentId(dt.originalTaskId, afterSegmentDate),
        isSplit: true,
        splitContinuesBefore: true,
        splitContinuesAfter: dt.splitContinuesAfter ?? false,
        // Override both raw and effective start to boundary
        startDate: boundary.date,
        startTime: boundary.time,
        effectiveStartDate: boundary.date,
        effectiveStartTime: boundary.time,
    };

    return [headSegment, tailSegment];
}

/**
 * Returns true when a DisplayTask belongs to the given visual date.
 * Timed tasks: check visual start date. AllDay tasks: check date range.
 */
export function isDisplayTaskOnVisualDate(
    dt: DisplayTask, visualDate: string, startHour: number
): boolean {
    if (!dt.effectiveStartDate) return false;
    // True all-day: no explicit start or end time in original task
    const isAllDay = !dt.startTime && !dt.endTime;
    if (!isAllDay && dt.effectiveStartTime) {
        return DateUtils.toVisualDate(
            dt.effectiveStartDate, dt.effectiveStartTime, startHour
        ) === visualDate;
    }
    // AllDay: date range check
    const end = dt.effectiveEndDate || dt.effectiveStartDate;
    return dt.effectiveStartDate <= visualDate && visualDate <= end;
}
