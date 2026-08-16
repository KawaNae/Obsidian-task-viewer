import type { Task } from '../../../types';

/** The date fields a line's `@` block is written from. */
export type DatedTask = Pick<Task, 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due'>;

/**
 * The `@` block of a task line: start, end and due as the notation writes them.
 *
 * One implementation, two readers. The line formatter writes it into the line,
 * and the `dates` built-in hands the same string to a generation block so a
 * block can carry a task's whole date block without rebuilding it out of the
 * parts. Rebuilding is exactly what this exists to prevent: a block that
 * writes `@${start}` looks right and drops the end and the due silently.
 *
 * Empty when there is nothing to write. A task with no dates at all has no
 * block, and the caller decides what an absent block looks like — a space
 * before it in the line, nothing at all in an interpolation.
 *
 * What it promises is that the block reads back as the same task, not that
 * every field survives as a field. An end on the start's own day is not
 * written — the notation says that by leaving it out — so reading the line
 * again gives a task with no end date. That is the notation's rule and it is
 * what saving a hand-written line does too; it is not a leak in this function.
 *
 * The shapes it produces, which are the notation's own:
 * - `@2026-08-19` / `@2026-08-19T09:00` — a start, with its time
 * - `@09:00` — a time with no date
 * - `@2026-08-19>2026-08-23` — a start and a different end
 * - `@2026-08-19>10:00` — an end on the same day, which is written as a time
 * - `@2026-08-19>>2026-08-25` — a start and a due, with the end left out
 * - `@>>2026-08-25` — a due alone
 */
export function formatDateBlock(task: DatedTask): string {
    let block = '';
    if (task.startDate) {
        block = `@${task.startDate}`;
        if (task.startTime) block += `T${task.startTime}`;
    } else if (task.startTime) {
        block = `@${task.startTime}`;
    } else if (task.endDate || task.endTime || task.due) {
        // The marker still has to be there: what follows is read by position.
        block = '@';
    } else {
        return '';
    }

    if (task.endDate) {
        // An end on the start's own day is the notation's default, so it is
        // written only when it carries a time of its own.
        const isSameDay = task.startDate ? task.endDate === task.startDate : false;
        if (!isSameDay || task.endTime) {
            block += '>';
            if (!isSameDay) {
                block += task.endDate;
                if (task.endTime) block += `T${task.endTime}`;
            } else {
                block += task.endTime;
            }
        } else if (task.due) {
            block += '>';
        }
    } else if (task.endTime) {
        block += `>${task.endTime}`;
    } else if (task.due) {
        block += '>';
    }

    if (task.due) block += `>${task.due}`;
    return block;
}
