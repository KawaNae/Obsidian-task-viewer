import type { StatedDates, Task } from '../types';
import { DateUtils } from './DateUtils';

/**
 * The dates a task's note states for it: what its line writes, and what its
 * section and frontmatter give it where the line writes nothing (`line ??
 * inherited`, field by field). Nothing is filled in: a bare date has no time,
 * a start has no end, a start time has no end time. The values are kept in
 * the form they are written, not moved to the visual day.
 *
 * What a card's top right shows (`TopRightFieldResolver`), and what the
 * rules that fill in the rest start from (`resolveEffectiveDates`).
 * `toDisplayTask` makes it once, before a task is split, so every segment of
 * a split task states the dates of the line.
 */
export function statedDates(task: Task): StatedDates {
    const inherited = task.cascadeContext;
    const stated: StatedDates = {};
    const startDate = stateOf(task.startDate, inherited?.startDate);
    const startTime = DateUtils.timeOfDay(stateOf(task.startTime, inherited?.startTime));
    const endDate = stateOf(task.endDate, inherited?.endDate);
    const endTime = DateUtils.timeOfDay(stateOf(task.endTime, inherited?.endTime));
    const due = stateOf(task.due, inherited?.due);
    if (startDate) stated.startDate = startDate;
    if (startTime) stated.startTime = startTime;
    if (endDate) stated.endDate = endDate;
    if (endTime) stated.endTime = endTime;
    if (due) stated.due = due;
    return stated;
}

/** The line's value, or the inherited one; an empty value is none. */
function stateOf(own: string | undefined, inherited: string | undefined): string | undefined {
    return own || inherited || undefined;
}
