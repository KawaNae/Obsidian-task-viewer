import type { Task } from '../types';
import { DateUtils } from './DateUtils';

/** A date a task line writes, by its place in the `@` block: start, end, due. */
export type DateField = 'start' | 'end' | 'due';

/** The dates of a task that a shift by whole days moves. */
type ShiftedDates = Pick<Task, 'startDate' | 'endDate' | 'due'>;

/**
 * `task` with the dates of `fields` moved by `days` whole days
 * (`DateUtils.shiftDateString`), each time of day kept, and every other
 * field as it was. A field the task does not write stays unwritten.
 *
 * Moving a task by days has two readers, one rule. A line built from a
 * task, the next instance of a recurring one (`FlowPlanner`), is shifted
 * here, as a task. A copy of a line the user wrote, a duplicate on another
 * day, is shifted as the line (`shiftLineDates`), so nothing outside the
 * dates is reworded. Both take the fields from the caller and move each
 * date with `shiftDateString`. Moving a task by dragging it is not a shift
 * by days and uses neither.
 */
export function shiftTaskDates<T extends ShiftedDates>(task: T, days: number, fields: readonly DateField[]): T {
    const out = { ...task };
    const shift = (value: string | undefined) => value && DateUtils.shiftDateString(value, days);
    if (fields.includes('start') && task.startDate) out.startDate = shift(task.startDate);
    if (fields.includes('end') && task.endDate) out.endDate = shift(task.endDate);
    if (fields.includes('due') && task.due) out.due = shift(task.due);
    return out;
}
