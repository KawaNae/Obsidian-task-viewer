import type { DisplayTask, StatedDates, Task, TaskSpan } from '../types';
import { DateUtils } from './DateUtils';
import { dayStart, instantAt, instantText, visualDayOf } from './DayWindow';

/**
 * The dates a task's note states for it: what its line writes, and what its
 * section and frontmatter give it where the line writes nothing (`line ??
 * inherited`, field by field). Nothing is filled in: a bare date has no time,
 * a start has no end, a start time has no end time. The values are kept in
 * the form they are written, not moved to the visual day.
 *
 * What a card's top right shows (`TopRightFieldResolver`), and what the
 * rules that fill in the rest start from (`resolveSpan`).
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

/** What a task occupies and when it is due, as moments (`resolveSpan`). */
export interface ResolvedSpan {
    span: TaskSpan | null;
    dueMs: number | null;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * The time a task occupies, `[startMs, endMs)`, and the moment it is due,
 * from the dates its note states: the one place the rules fill in what is
 * not written. `toDisplayTask` puts the answer on the display copy, and a
 * write that needs the slot a task fills (a duplicate moved on the clock)
 * asks it here.
 *
 * The rules (`dayStart(D)` is D at `startHour:00`):
 *
 * | written | start | end |
 * |---|---|---|
 * | `@D` | `dayStart(D)` | `dayStart(D+1)` |
 * | `@D>E` | `dayStart(D)` | the end of E's implicit `(startHour−1):59`: `dayStart(E)` |
 * | `@>E` | the start of the visual day that end is in | the same end |
 * | `@DT10:00` | D 10:00 | an hour later |
 * | `@DT10:00>11:00` | D 10:00 | D 11:00, the next day's when before the start |
 * | `@DT22:00>E` | D 22:00 | as `@D>E` |
 * | `@DT10:00>D` (the implicit end before the start) | D 10:00 | D 23:59 |
 * | `@>>D` | no span | due `dayStart(D+1)` |
 * | `@>>DT17:00` | no span | due D 17:00 |
 *
 * A date-only end is `(startHour−1):59` and the minute after it: at
 * `startHour` 0 that is the end of E itself. A time inherited from the
 * section or the note is a written time. The rows rule 4 calls errors
 * (`@D>ET10:00`, `@>ET17:00`, `@D>DT02:00`) are not drawn; they are
 * resolved the same way for the API's `includeInvalid`.
 */
export function resolveSpan(stated: StatedDates, startHour: number): ResolvedSpan {
    return { span: spanOf(stated, startHour), dueMs: dueMsOf(stated.due, startHour) };
}

function spanOf(stated: StatedDates, startHour: number): TaskSpan | null {
    const span = rawSpanOf(stated, startHour);
    return span && Number.isFinite(span.startMs) && Number.isFinite(span.endMs) ? span : null;
}

function rawSpanOf(stated: StatedDates, startHour: number): TaskSpan | null {
    const { startDate, startTime, endDate, endTime } = stated;
    // The minute after a date-only end, `(startHour−1):59`.
    const afterDateEnd = (startHour === 0 ? 24 : startHour) * 60;

    if (!startDate) {
        if (!endDate) return null;
        if (endTime) {
            // An end time: the default length before it.
            const end = DateUtils.timeToMinutes(endTime);
            return {
                startMs: instantAt(endDate, end - DateUtils.DEFAULT_TIMED_DURATION_MINUTES),
                endMs: instantAt(endDate, end),
            };
        }
        // A bare end date: the visual day its implicit end falls in.
        const day = startHour === 0 ? endDate : DateUtils.addDays(endDate, -1);
        return { startMs: dayStart(day, startHour), endMs: instantAt(endDate, afterDateEnd) };
    }

    const start = startTime ? DateUtils.timeToMinutes(startTime) : startHour * 60;
    const startMs = instantAt(startDate, start);

    if (!endDate) {
        if (endTime) {
            const end = DateUtils.timeToMinutes(endTime);
            return { startMs, endMs: instantAt(end < start ? DateUtils.addDays(startDate, 1) : startDate, end) };
        }
        if (startTime) return { startMs, endMs: instantAt(startDate, start + DateUtils.DEFAULT_TIMED_DURATION_MINUTES) };
        return { startMs, endMs: instantAt(startDate, start + MINUTES_PER_DAY) };
    }

    // A written end date. The implicit end, `(startHour−1):59`, is read as
    // that minute when weighed against the start.
    const end = endTime ? DateUtils.timeToMinutes(endTime) : afterDateEnd - 1;
    if (startDate === endDate && !startTime !== !endTime && end < start) {
        // One side implicit and the end before the start on the same date:
        // the implicit side gives way (start at 00:00, or end at 23:59).
        return startTime
            ? { startMs, endMs: instantAt(endDate, MINUTES_PER_DAY - 1) }
            : { startMs: instantAt(startDate, 0), endMs: instantAt(endDate, end) };
    }
    return { startMs, endMs: instantAt(endDate, endTime ? end : afterDateEnd) };
}

function dueMsOf(due: string | undefined, startHour: number): number | null {
    if (!due) return null;
    const { date, time } = DateUtils.splitDateTime(due);
    const ms = time
        ? instantAt(date, DateUtils.timeToMinutes(time))
        : dayStart(DateUtils.addDays(date, 1), startHour);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * The date a date-only end is written with to end at `endMs` (a day's
 * start), under the rule `resolveSpan` reads it by: the end of E's implicit
 * `(startHour−1):59`, which is `dayStart(E)`, or at `startHour` 0 the end of
 * E itself.
 */
export function dateOnlyEndDate(endMs: number, startHour: number): string {
    const { date } = instantText(endMs);
    return startHour === 0 ? DateUtils.addDays(date, -1) : date;
}

/**
 * One side of a task (its start or its end) as the hub and the menu show
 * it: what the line writes, else what it inherits, else what the rules make
 * of it. A value the rules make is given at the precision it would be
 * written with, so copied into the line it means the same: a side that rests
 * on a bare date has a date and no time (no `05:00`), and a side the rules
 * time (the default hour's end, `T23:30`'s `00:30` the next day) has both.
 */
export interface SideValue {
    date?: string;
    time?: string;
    /** Whether the line writes the date / the time (the rest is shown faint). */
    dateWritten: boolean;
    timeWritten: boolean;
}

type SideSource = Pick<DisplayTask, 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'stated' | 'span'>;

/** The start and the end as {@link SideValue}s; null for a task with no span. */
export function sideValues(task: SideSource, startHour: number): { start: SideValue; end: SideValue } | null {
    const { span, stated } = task;
    if (!span) return null;

    // A side rests on a bare date when no time stands behind it.
    const bareStart = stated.startDate ? !stated.startTime : !stated.endTime;
    const bareEnd = !stated.endTime && (!!stated.endDate || !stated.startTime);
    const start = instantText(span.startMs);
    const end = instantText(span.endMs);

    return {
        start: side(task.startDate, task.startTime, stated.startDate, stated.startTime,
            bareStart ? visualDayOf(span.startMs, startHour) : start.date,
            bareStart ? undefined : start.time),
        end: side(task.endDate, task.endTime, stated.endDate, stated.endTime,
            bareEnd ? dateOnlyEndDate(span.endMs, startHour) : end.date,
            bareEnd ? undefined : end.time),
    };
}

function side(
    ownDate: string | undefined, ownTime: string | undefined,
    statedDate: string | undefined, statedTime: string | undefined,
    madeDate: string, madeTime: string | undefined,
): SideValue {
    const value: SideValue = { dateWritten: !!ownDate, timeWritten: !!ownTime };
    const date = ownDate || statedDate || madeDate;
    const time = ownTime || statedTime || madeTime;
    if (date) value.date = date;
    if (time) value.time = time;
    return value;
}
