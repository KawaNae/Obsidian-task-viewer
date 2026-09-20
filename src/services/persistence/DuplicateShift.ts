import type { DisplayTask, Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

/**
 * Where the copies of a "duplicate in place" go on the clock.
 *
 * A copy that lands on the original's own slot is two cards in the same
 * place with the same words: the view stacks them, and the matcher that
 * hands runtime ids to lines has nothing to tell them apart by. So a copy
 * starts where the original ends — implicitly an hour later when the task
 * never wrote an end, at the written end when it did — and keeps its
 * length. Asking for several chains them, each starting where the one
 * before it ends.
 *
 * A task with no dates has no slot to move out of, and an all-day task
 * fills its day already, so neither is shifted; copies of those are the
 * original again, and only their position in the file separates them.
 */

interface Instant {
    date: string;
    minutes: number;
}

function advance(from: Instant, minutes: number): Instant {
    const total = from.minutes + minutes;
    const days = Math.floor(total / 1440);
    return { date: DateUtils.addDays(from.date, days), minutes: total - days * 1440 };
}

function span(from: Instant, to: Instant): number {
    return DateUtils.getDiffDays(from.date, to.date) * 1440 + (to.minutes - from.minutes);
}

/**
 * The copies to write for a duplicate with no day offset, in file order.
 *
 * Each copy is the task with its block id dropped — the id belongs to the
 * line that was written, not to a copy of it — and its instants moved on by
 * one length each.
 *
 * A copy writes only what it needs to sit where it now sits. A line that
 * wrote a time and took its day from the note's scope keeps that shape
 * while the shift stays inside the day, so it goes on following the scope;
 * once the shift leaves the day, scope can no longer say where the copy is
 * and the date is spelled out. A task that wrote no end keeps writing none:
 * the hour it was given implicitly is its length, and the copy is given the
 * same hour the same way.
 */
export function planInPlaceCopies(task: Task, display: DisplayTask, count: number): Task[] {
    const copies: Task[] = [];
    const base: Task = { ...task, blockId: undefined };

    const shiftable = !display.startTimeImplicit
        && !!display.effectiveStartDate && !!display.effectiveStartTime
        && !!display.effectiveEndDate && !!display.effectiveEndTime;

    if (!shiftable) {
        for (let i = 0; i < count; i++) copies.push({ ...base });
        return copies;
    }

    const start: Instant = {
        date: display.effectiveStartDate,
        minutes: DateUtils.timeToMinutes(display.effectiveStartTime!),
    };
    const end: Instant = {
        date: display.effectiveEndDate!,
        minutes: DateUtils.timeToMinutes(display.effectiveEndTime!),
    };
    const length = span(start, end);

    // A task of no length would put every copy on the original's own slot,
    // which is the one place a copy must not go. Give it the default hour.
    const step = length > 0 ? length : DateUtils.DEFAULT_TIMED_DURATION_MINUTES;

    // A start written as a time alone belongs to the day its scope names, so
    // the copy can stay that shape only while it stays in that day.
    const startIsScopeDated = !task.startDate && !!task.startTime;
    const endIsScopeDated = !task.endDate && !!task.endTime;

    for (let i = 1; i <= count; i++) {
        const copyStart = advance(start, step * i);
        const copy: Task = { ...base };

        copy.startTime = DateUtils.minutesToTime(copyStart.minutes);
        if (!startIsScopeDated || copyStart.date !== start.date) {
            copy.startDate = copyStart.date;
        }

        // No written end means the length was the implicit hour; leaving the
        // end unwritten gives the copy that same hour.
        if (task.endDate || task.endTime) {
            const copyEnd = advance(end, step * i);
            copy.endTime = DateUtils.minutesToTime(copyEnd.minutes);
            // An end written as a time alone and falling before its start is
            // read as the next day, which is where it belongs. Anything
            // further out has to say the date.
            const readsAsNextDay = DateUtils.getDiffDays(copyStart.date, copyEnd.date) === 1
                && copyEnd.minutes < copyStart.minutes;
            if (!endIsScopeDated || (copyEnd.date !== copyStart.date && !readsAsNextDay)) {
                copy.endDate = copyEnd.date;
            }
        }

        copies.push(copy);
    }

    return copies;
}
