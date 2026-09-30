import type { DuplicateOptions, Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { resolveEffectiveDates } from '../../utils/EffectiveDates';
import { formatRow } from '../parsing/TaskLineFormat';
import { shiftLineDates } from '../parsing/tv-inline/DateBlock';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
import type { CopyLines, TaskOp } from '../persistence/TaskOps';

/**
 * What a duplicate writes ({@link planDuplicate}): copies on other days, or
 * copies that continue the task along the clock.
 *
 * Along the clock, a copy that lands on the original's own slot is two cards in the same
 * place with the same words: the view stacks them, and nothing tells the
 * user which is which. So a copy
 * starts where the original ends — implicitly an hour later when the task
 * never wrote an end, at the written or inherited end when it has one — and
 * keeps its length. Asking for several chains them, each starting where the
 * one before it ends.
 *
 * A task that holds no time has no slot to move out of. A bare date, a
 * span of whole days, a line with no dates at all: each one already fills
 * whatever it covers, and its copies are the line again, written out
 * unchanged.
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
 * Whether the task holds a time of day that a copy can be moved past.
 *
 * Both ends have to be real. A start is real when the line or its scope
 * wrote one; an end is real when the line or its scope wrote one, or when
 * there is no end date at all and the default hour applies. An end date
 * with no time is not a time: it means "to the end of that day", and the
 * clock reading it gets (the last minute before the day rolls over) is a
 * setting, not something the task said.
 */
function holdsTimeOfDay(task: Task): boolean {
    const startTime = task.startTime ?? task.cascadeContext?.startTime;
    const endTime = task.endTime ?? task.cascadeContext?.endTime;
    const endDate = task.endDate ?? task.cascadeContext?.endDate;
    return !!startTime && (!!endTime || !endDate);
}

/**
 * What a duplicate of `task` writes, and on which side of it: the one op the
 * index hands the write (`TaskIndex.writeDuplicate`). What the copies say is
 * decided here, where the task's dates are known; where they go is the
 * write's (`TaskOp` `copies`). Each copy carries the row's children.
 *
 * `dayOffset` picks the axis and `count` says how many copies. With an offset
 * the copies run along the calendar ({@link dayShiftedCopies}) and go above
 * the row, the newest first; without one they run along the clock
 * ({@link planInPlaceCopies}) and go past its subtree, so the day reads in
 * time order.
 */
export function planDuplicate(task: Task, options: DuplicateOptions | undefined, startHour: number): Extract<TaskOp, { kind: 'copies' }> {
    const { dayOffset = 0, count = 1 } = options ?? {};
    return dayOffset !== 0
        ? { kind: 'copies', side: 'above', lines: dayShiftedCopies(task, dayOffset, count), children: true }
        : { kind: 'copies', side: 'below', lines: planInPlaceCopies(task, startHour, count), children: true };
}

/**
 * The copies of a duplicate on other days, in file order: one for each day
 * of `dayOffset..dayOffset+count-1`, future first, so a newer date stands
 * above an older one.
 *
 * Each is the line the task was read from (`originalText`, the line the
 * write checks the row against), without its `^id`, with its start, end and
 * due moved by the copy's days (`shiftLineDates`): the user's own line, with
 * nothing outside those dates reworded. A date in the command stays as it
 * is.
 */
export function dayShiftedCopies(task: Task, dayOffset: number, count: number): string[] {
    const line = TaskLineClassifier.stripBlockIds([task.originalText])[0];
    const copies: string[] = [];
    for (let offset = dayOffset + count - 1; offset >= dayOffset; offset--) {
        copies.push(shiftLineDates(line, offset, ['start', 'end', 'due']));
    }
    return copies;
}

/**
 * The copies to write for a duplicate with no day offset, in file order.
 *
 * A task that holds no time of day is repeated as the file writes it
 * (`verbatim`). Any other copy is the task with its block id dropped — the
 * id belongs to the line that was written, not to a copy of it — and its
 * instants moved on by one length each, written by `formatRow`.
 *
 * A copy writes only what it needs to sit where it now sits. A line that
 * wrote a time and took its day from the note's scope keeps that shape
 * while the shift stays inside the day, so it goes on following the scope;
 * once the shift leaves the day, scope can no longer say where the copy is
 * and the date is spelled out. An end the task never wrote and never
 * inherited stays unwritten: the hour it was given implicitly is its
 * length, and the copy is given the same hour the same way. An end it did
 * inherit is written out, because the inherited value does not move with
 * the copy and would otherwise cut its length.
 */
export function planInPlaceCopies(task: Task, startHour: number, count: number): CopyLines {
    const dates = resolveEffectiveDates(task, startHour);
    const shiftable = holdsTimeOfDay(task)
        && !!dates.effectiveStartDate && !!dates.effectiveStartTime
        && !!dates.effectiveEndDate && !!dates.effectiveEndTime;

    if (!shiftable) return { verbatim: count };

    const start: Instant = {
        date: dates.effectiveStartDate,
        minutes: DateUtils.timeToMinutes(dates.effectiveStartTime!),
    };
    const end: Instant = {
        date: dates.effectiveEndDate!,
        minutes: DateUtils.timeToMinutes(dates.effectiveEndTime!),
    };
    const length = span(start, end);

    // A task of no length would put every copy on the original's own slot,
    // which is the one place a copy must not go. Give it the default hour.
    const step = length > 0 ? length : DateUtils.DEFAULT_TIMED_DURATION_MINUTES;

    // An end that came from scope has to be written out: it stays where it
    // is while the copy moves, so leaving it would give the copy a different
    // length from the one it is copying.
    const endIsWritten = !!(task.endTime ?? task.cascadeContext?.endTime);
    // A start or end written as a time alone belongs to the day its scope
    // names, so the copy can stay that shape only while it stays in that day.
    const startIsScopeDated = !task.startDate && !!task.startTime;
    const endIsScopeDated = !task.endDate && !!task.endTime;

    const base: Task = { ...task, blockId: undefined };
    const copies: string[] = [];

    for (let i = 1; i <= count; i++) {
        const copyStart = advance(start, step * i);
        const copy: Task = { ...base };

        copy.startTime = DateUtils.minutesToTime(copyStart.minutes);
        if (!startIsScopeDated || copyStart.date !== start.date) {
            copy.startDate = copyStart.date;
        }

        if (endIsWritten) {
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

        copies.push(formatRow(copy));
    }

    return copies;
}
