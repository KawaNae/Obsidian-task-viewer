import type { Task, DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { TaskIdGenerator } from './TaskIdGenerator';
import { buildChildEntries } from '../data/ChildEntryBuilder';

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
 * and materialized {@link ChildEntry} list. This is the single entry point
 * for implicit value resolution.
 *
 * `getTask` resolves sibling tasks for child-entry partitioning. Pass
 * {@link NO_TASK_LOOKUP} for synthetic temp tasks that have no children
 * (modal placeholders, drag previews, etc.).
 */
export function toDisplayTask(task: Task, startHour: number, getTask: TaskLookup): DisplayTask {
    let effectiveStartDate = task.startDate ?? '';
    let effectiveStartTime = task.startTime;
    let effectiveEndDate = task.endDate;
    let effectiveEndTime = task.endTime;

    // startDateInherited = daily note inherited date (has value but not explicitly written in notation)
    const startDateExplicit = !!task.startDate && !task.startDateInherited;

    let startDateImplicit = !startDateExplicit;
    let startTimeImplicit = !task.startTime;
    let endDateImplicit = !task.endDate;
    let endTimeImplicit = !task.endTime;

    // Resolve implicit start for E/ED types (have endDate, no startDate at all)
    if (!task.startDate && task.endDate) {
        if (task.endTime) {
            // E-Timed: 1 hour before endTime
            const endMinutes = DateUtils.timeToMinutes(task.endTime);
            const startMinutes = endMinutes - DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
            if (startMinutes >= 0) {
                effectiveStartDate = task.endDate;
                effectiveStartTime = DateUtils.minutesToTime(startMinutes);
            } else {
                effectiveStartDate = DateUtils.addDays(task.endDate, -1);
                effectiveStartTime = DateUtils.minutesToTime(startMinutes + 24 * 60);
            }
        } else {
            // E-AllDay: resolve endTime first, then find visual day start
            const endHour = startHour === 0 ? 23 : startHour - 1;
            const implicitEndTime = `${endHour.toString().padStart(2, '0')}:59`;
            effectiveEndTime = implicitEndTime;
            effectiveStartDate = DateUtils.toVisualDate(task.endDate, implicitEndTime, startHour);
            effectiveStartTime = startHour.toString().padStart(2, '0') + ':00';
        }
        // startDateImplicit / startTimeImplicit remain true
    }

    // Resolve implicit start time for all-day tasks (date only, no time)
    if (effectiveStartDate && !effectiveStartTime) {
        effectiveStartTime = startHour.toString().padStart(2, '0') + ':00';
    }

    // Resolve implicit end for S/SD types (have startDate, no endDate)
    if (effectiveStartDate && !task.endDate) {
        if (task.endTime) {
            // endTime is explicit, only endDate needs resolution
            // Cross-midnight fallback: if endTime < startTime, resolve to next calendar day
            if (effectiveStartTime && task.endTime < effectiveStartTime) {
                effectiveEndDate = DateUtils.addDays(effectiveStartDate, 1);
            } else {
                effectiveEndDate = effectiveStartDate;
            }
        } else if (task.startTime) {
            // S-Timed: startTime + DEFAULT_TIMED_DURATION_MINUTES
            const startMinutes = DateUtils.timeToMinutes(effectiveStartTime!);
            const endMinutes = startMinutes + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
            if (endMinutes < 24 * 60) {
                effectiveEndDate = effectiveStartDate;
                effectiveEndTime = DateUtils.minutesToTime(endMinutes);
            } else {
                effectiveEndDate = DateUtils.addDays(effectiveStartDate, 1);
                effectiveEndTime = DateUtils.minutesToTime(endMinutes - 24 * 60);
            }
        } else {
            // S-AllDay: startTime (resolved above) + 23h59m
            const startMinutes = DateUtils.timeToMinutes(effectiveStartTime!);
            const endMinutes = startMinutes + 23 * 60 + 59;
            effectiveEndDate = DateUtils.addDays(effectiveStartDate, Math.floor(endMinutes / (24 * 60)));
            effectiveEndTime = DateUtils.minutesToTime(endMinutes % (24 * 60));
        }
        // endDateImplicit remains true (endDate was not explicit)
    }

    // Resolve implicit end time for SE/SED types (have endDate, no endTime)
    if (effectiveEndDate && !effectiveEndTime) {
        const endHour = startHour === 0 ? 23 : startHour - 1;
        effectiveEndTime = `${endHour.toString().padStart(2, '0')}:59`;
    }

    // Fallback: if same calendarDate and implicit end < implicit start, use 00:00/23:59
    if (effectiveStartDate && effectiveEndDate
        && effectiveStartDate === effectiveEndDate
        && effectiveStartTime && effectiveEndTime
        && startTimeImplicit !== endTimeImplicit
        && effectiveEndTime < effectiveStartTime) {
        if (startTimeImplicit) {
            effectiveStartTime = '00:00';
        }
        if (endTimeImplicit) {
            effectiveEndTime = '23:59';
        }
    }

    // For explicit fields, mark as non-implicit
    if (startDateExplicit) startDateImplicit = false;
    if (task.startTime) startTimeImplicit = false;
    if (task.endDate) endDateImplicit = false;
    if (task.endTime) endTimeImplicit = false;

    return {
        ...task,
        effectiveStartDate,
        effectiveStartTime,
        effectiveEndDate,
        effectiveEndTime,
        startDateImplicit,
        startTimeImplicit,
        endDateImplicit,
        endTimeImplicit,
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
    const boundaryTime = `${startHour.toString().padStart(2, '0')}:00`;
    // 直前 boundary 時刻 (例: startHour=5 なら '04:59')。head の effective end に
    // これを使うことで、`toVisualDate` が前日に -1 day シフトし、tail の visual
    // start day と重ならない。boundaryTime ('05:00') を head end に置くと
    // toVisualDate (`h < startHour`) が当日扱いとなり tail と同日に重複し、
    // GridTaskLayout の greedy track 割り当てで別 track に飛ぶバグを生む。
    // (cf. TaskSplitter.splitAtDateBoundary が同じ pattern を採用済み)
    const beforeBoundaryTime = startHour === 0
        ? '23:59'
        : `${(startHour - 1).toString().padStart(2, '0')}:59`;

    if (dt.effectiveStartDate === dt.effectiveEndDate) {
        boundaryCalendarDate = dt.effectiveStartDate;
    } else {
        boundaryCalendarDate = DateUtils.addDays(dt.effectiveStartDate, 1);
    }

    const beforeSegmentDate = DateUtils.toVisualDate(dt.effectiveStartDate, dt.effectiveStartTime, startHour);
    const afterSegmentDate = DateUtils.toVisualDate(boundaryCalendarDate, boundaryTime, startHour);

    const headSegment: DisplayTask = {
        ...dt,
        id: TaskIdGenerator.makeSegmentId(dt.originalTaskId, beforeSegmentDate),
        isSplit: true,
        splitContinuesBefore: dt.splitContinuesBefore ?? false,
        splitContinuesAfter: true,
        // Override both raw and effective end to boundary - 1min (前日 inclusive)
        endDate: boundaryCalendarDate,
        endTime: beforeBoundaryTime,
        effectiveEndDate: boundaryCalendarDate,
        effectiveEndTime: beforeBoundaryTime,
    };

    const tailSegment: DisplayTask = {
        ...dt,
        id: TaskIdGenerator.makeSegmentId(dt.originalTaskId, afterSegmentDate),
        isSplit: true,
        splitContinuesBefore: true,
        splitContinuesAfter: dt.splitContinuesAfter ?? false,
        // Override both raw and effective start to boundary
        startDate: boundaryCalendarDate,
        startTime: boundaryTime,
        effectiveStartDate: boundaryCalendarDate,
        effectiveStartTime: boundaryTime,
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

/**
 * Convert a Task to DisplayTask(s), splitting at the visual day boundary if needed.
 * Returns 1 element for non-split tasks, 2 for split tasks.
 */
export function toDisplayTaskWithSplit(task: Task, startHour: number, getTask: TaskLookup): DisplayTask[] {
    const dt = toDisplayTask(task, startHour, getTask);
    if (shouldSplitDisplayTask(dt, startHour)) {
        const [head, tail] = splitDisplayTaskAtBoundary(dt, startHour);
        return [head, tail];
    }
    return [dt];
}
