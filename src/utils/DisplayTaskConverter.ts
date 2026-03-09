import type { Task, DisplayTask } from '../types';
import { DateUtils } from './DateUtils';
import { TaskIdGenerator } from './TaskIdGenerator';

/**
 * Converts raw Task objects into DisplayTask with resolved effective fields.
 * This is the single entry point for implicit value resolution.
 */
export function toDisplayTask(task: Task, startHour: number): DisplayTask {
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
            // E-AllDay: same day
            effectiveStartDate = task.endDate;
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
            // endTime is explicit, only endDate needs resolution (same-day inheritance)
            effectiveEndDate = effectiveStartDate;
            // effectiveEndTime already set from task.endTime (line 14)
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
    };
}

/** Batch convert tasks to DisplayTask (no split). */
export function toDisplayTasks(tasks: Task[], startHour: number): DisplayTask[] {
    return tasks.map(t => toDisplayTask(t, startHour));
}

/**
 * Returns true when a DisplayTask crosses the visual day boundary and should be split.
 * Uses effective values so E/ED types can also be split.
 */
export function shouldSplitDisplayTask(dt: DisplayTask, startHour: number): boolean {
    if (!dt.effectiveStartDate || !dt.effectiveEndDate || !dt.effectiveStartTime || !dt.effectiveEndTime) {
        return false;
    }

    const visualStartDay = DateUtils.getVisualStartDate(dt.effectiveStartDate, dt.effectiveStartTime, startHour);

    let visualEndDay = dt.effectiveEndDate;
    const [endH, endM] = dt.effectiveEndTime.split(':').map(Number);
    if (endH < startHour || (endH === startHour && endM === 0)) {
        visualEndDay = DateUtils.addDays(dt.effectiveEndDate, -1);
    }

    if (visualStartDay !== visualEndDay) {
        return true;
    }

    const startDateTime = new Date(`${dt.effectiveStartDate}T${dt.effectiveStartTime}`);
    const endDateTime = new Date(`${dt.effectiveEndDate}T${dt.effectiveEndTime}`);
    if (endDateTime < startDateTime) return false;

    const durationHours = (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
    if (durationHours >= 24) return false;

    return false;
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

    if (dt.effectiveStartDate === dt.effectiveEndDate) {
        boundaryCalendarDate = dt.effectiveStartDate;
    } else {
        boundaryCalendarDate = DateUtils.addDays(dt.effectiveStartDate, 1);
    }

    const beforeSegmentDate = DateUtils.getVisualStartDate(dt.effectiveStartDate, dt.effectiveStartTime, startHour);
    const afterSegmentDate = DateUtils.getVisualStartDate(boundaryCalendarDate, boundaryTime, startHour);

    const headSegment: DisplayTask = {
        ...dt,
        id: TaskIdGenerator.makeSegmentId(dt.originalTaskId, beforeSegmentDate),
        isSplit: true,
        splitSegment: 'head',
        // Override both raw and effective end to boundary
        endDate: boundaryCalendarDate,
        endTime: boundaryTime,
        effectiveEndDate: boundaryCalendarDate,
        effectiveEndTime: boundaryTime,
    };

    const tailSegment: DisplayTask = {
        ...dt,
        id: TaskIdGenerator.makeSegmentId(dt.originalTaskId, afterSegmentDate),
        isSplit: true,
        splitSegment: 'tail',
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
    if (dt.effectiveStartTime) {
        return DateUtils.getVisualStartDate(
            dt.effectiveStartDate, dt.effectiveStartTime, startHour
        ) === visualDate;
    }
    // AllDay: effectiveStartDate ≤ visualDate ≤ effectiveEndDate
    const end = dt.effectiveEndDate || dt.effectiveStartDate;
    return dt.effectiveStartDate <= visualDate && visualDate <= end;
}

/**
 * Convert a Task to DisplayTask(s), splitting at the visual day boundary if needed.
 * Returns 1 element for non-split tasks, 2 for split tasks.
 */
export function toDisplayTaskWithSplit(task: Task, startHour: number): DisplayTask[] {
    const dt = toDisplayTask(task, startHour);
    if (shouldSplitDisplayTask(dt, startHour)) {
        const [head, tail] = splitDisplayTaskAtBoundary(dt, startHour);
        return [head, tail];
    }
    return [dt];
}
