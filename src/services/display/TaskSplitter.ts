import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { dayStart, visualDaysOf } from '../../utils/DayWindow';
import {
    getOriginalTaskId,
    shouldSplitDisplayTask,
    splitDisplayTaskAtBoundary,
} from './DisplayTaskConverter';
import { makeSegmentId } from './SegmentIds';

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
    if (!dt.drawn) {
        result.push(dt);
        return;
    }
    const { first, last } = visualDaysOf(dt.drawn, startHour);

    // Task entirely outside range, or entirely inside — pass through without splitting
    if (last < rangeStart || first > rangeEnd) {
        result.push(dt);
        return;
    }
    const extendsBeforeRange = first < rangeStart;
    const extendsAfterRange = last > rangeEnd;
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
 * Splits a DisplayTask at the start of `boundaryDate`'s visual day. The head
 * is drawn up to the boundary, the tail from it; a segment's line values,
 * `stated` and `span` are the whole task's. Continuation flags accumulate
 * (OR) across multiple splits.
 */
function splitAtDateBoundary(dt: DisplayTask, boundaryDate: string, startHour: number): [DisplayTask, DisplayTask] {
    const originalId = getOriginalTaskId(dt);
    const drawn = dt.drawn!;
    const boundaryMs = dayStart(boundaryDate, startHour);

    const head: DisplayTask = {
        ...dt,
        id: makeSegmentId(originalId, visualDaysOf(drawn, startHour).first),
        drawn: { startMs: drawn.startMs, endMs: boundaryMs },
        isSplit: true,
        splitContinuesBefore: dt.splitContinuesBefore ?? false,
        splitContinuesAfter: true,
        originalTaskId: originalId,
    };

    const tail: DisplayTask = {
        ...dt,
        id: makeSegmentId(originalId, boundaryDate),
        drawn: { startMs: boundaryMs, endMs: drawn.endMs },
        isSplit: true,
        splitContinuesBefore: true,
        splitContinuesAfter: dt.splitContinuesAfter ?? false,
        originalTaskId: originalId,
    };

    return [head, tail];
}
