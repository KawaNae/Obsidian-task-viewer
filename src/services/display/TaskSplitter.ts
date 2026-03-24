import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import {
    getOriginalTaskId,
    shouldSplitDisplayTask,
    splitDisplayTaskAtBoundary,
} from './DisplayTaskConverter';
import { TaskIdGenerator } from './TaskIdGenerator';

export type SplitBoundary =
    | { type: 'visual-date'; startHour: number }
    | { type: 'date-range'; start: string; end: string; startHour: number };

/**
 * Splits DisplayTask[] at the given boundary.
 * - visual-date: tasks crossing startHour boundary → [head, tail] (array grows)
 * - date-range: tasks extending beyond range → clipped segments (all segments returned)
 */
export function splitTasks(tasks: DisplayTask[], boundary: SplitBoundary): DisplayTask[] {
    const result: DisplayTask[] = [];
    for (const dt of tasks) {
        if (boundary.type === 'visual-date') {
            if (shouldSplitDisplayTask(dt, boundary.startHour)) {
                const [head, tail] = splitDisplayTaskAtBoundary(dt, boundary.startHour);
                result.push(head, tail);
            } else {
                result.push(dt);
            }
        } else {
            splitAtDateRange(dt, boundary.start, boundary.end, result, boundary.startHour);
        }
    }
    return result;
}

/**
 * Splits a DisplayTask at date-range boundaries.
 * Tasks within range pass through; tasks extending beyond are clipped.
 * All segments (including out-of-range) are pushed to result.
 */
function splitAtDateRange(
    dt: DisplayTask, rangeStart: string, rangeEnd: string, result: DisplayTask[], startHour: number
): void {
    const taskStart = dt.effectiveStartDate;
    const taskEnd = dt.effectiveEndDate || dt.effectiveStartDate;

    if (!taskStart) {
        result.push(dt);
        return;
    }

    // Use visual dates for comparison (day boundary = startHour)
    const compareStart = DateUtils.getVisualStartDate(taskStart, dt.effectiveStartTime, startHour);
    const compareEnd = DateUtils.getVisualStartDate(taskEnd, dt.effectiveEndTime, startHour);

    // Task entirely outside range — pass through without splitting
    if (compareEnd < rangeStart || compareStart > rangeEnd) {
        result.push(dt);
        return;
    }

    const extendsBeforeRange = compareStart < rangeStart;
    const extendsAfterRange = compareEnd > rangeEnd;

    if (!extendsBeforeRange && !extendsAfterRange) {
        result.push(dt);
        return;
    }

    if (extendsBeforeRange && extendsAfterRange) {
        // Both ends extend → 3 segments: before, middle, after
        const [before, rest] = splitAtDateBoundary(dt, rangeStart, startHour);
        const [middle, after] = splitAtDateBoundary(rest, DateUtils.addDays(rangeEnd, 1), startHour);
        result.push(before, middle, after);
    } else if (extendsBeforeRange) {
        // Extends before only → 2 segments: before, inRange
        const [before, inRange] = splitAtDateBoundary(dt, rangeStart, startHour);
        result.push(before, inRange);
    } else {
        // Extends after only → 2 segments: inRange, after
        const [inRange, after] = splitAtDateBoundary(dt, DateUtils.addDays(rangeEnd, 1), startHour);
        result.push(inRange, after);
    }
}

/**
 * Splits a DisplayTask at a visual-day boundary (boundaryDate's startHour).
 * Head segment covers [taskStart, boundaryDate startHour-1:59].
 * Tail segment covers [boundaryDate startHour:00, taskEnd].
 * Continuation flags accumulate (OR) across multiple splits.
 */
function splitAtDateBoundary(dt: DisplayTask, boundaryDate: string, startHour: number): [DisplayTask, DisplayTask] {
    const originalId = getOriginalTaskId(dt);

    const boundaryTime = `${startHour.toString().padStart(2, '0')}:00`;
    const beforeBoundaryTime = startHour === 0
        ? '23:59'
        : `${(startHour - 1).toString().padStart(2, '0')}:59`;

    const head: DisplayTask = {
        ...dt,
        id: TaskIdGenerator.makeSegmentId(originalId, dt.effectiveStartDate),
        effectiveEndDate: boundaryDate,
        effectiveEndTime: beforeBoundaryTime,
        endDate: boundaryDate,
        isSplit: true,
        splitContinuesBefore: dt.splitContinuesBefore ?? false,
        splitContinuesAfter: true,
        originalTaskId: originalId,
    };

    const tail: DisplayTask = {
        ...dt,
        id: TaskIdGenerator.makeSegmentId(originalId, boundaryDate),
        effectiveStartDate: boundaryDate,
        effectiveStartTime: boundaryTime,
        startDate: boundaryDate,
        isSplit: true,
        splitContinuesBefore: true,
        splitContinuesAfter: dt.splitContinuesAfter ?? false,
        originalTaskId: originalId,
    };

    return [head, tail];
}
