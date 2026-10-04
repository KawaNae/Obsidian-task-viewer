import type { DisplayTask, StatedDates, Task, TaskSpan } from '../types';
import { DateUtils } from './DateUtils';
import { dayStart, endDayOf, instantAt, instantText, visualDayOf } from './DayWindow';

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

/**
 * The dates a span is read from: what the note states, and for a task with
 * neither a start date nor an end date but a due, the due as its end
 * (`@>>D` is read as `@>D`, `@>>DT17:00` as `@>DT17:00`). A task with only
 * a due occupies the time before it, as one with only an end does.
 * `resolveSpan`, `isAllDay` and `sideValues` read the span through this.
 */
export function spanDates(stated: StatedDates): StatedDates {
    if (stated.startDate || stated.endDate || !stated.due) return stated;
    const due = DateUtils.splitDateTime(stated.due);
    const date = due.date;
    const time = DateUtils.timeOfDay(due.time);
    const dates: StatedDates = { ...stated, endDate: date };
    if (time) dates.endTime = time;
    else delete dates.endTime;
    return dates;
}

/**
 * The time a task occupies, `[startMs, endMs)`, and the moment it is due,
 * from the dates its note states: the one place the rules fill in what is
 * not written. `toDisplayTask` puts the answer on the display copy, and a
 * write that needs the slot a task fills (a duplicate moved on the clock)
 * asks it here.
 *
 * A bare date D is the whole visual day D: written as a start it is D's
 * start, written as an end D's end. The rules (`dayStart(D)` is D at
 * `startHour:00`):
 *
 * | written | start | end |
 * |---|---|---|
 * | `@D` | `dayStart(D)` | `dayStart(D+1)` |
 * | `@D>E`, `@D>D` | `dayStart(D)` | `dayStart(E+1)` |
 * | `@>E` | `dayStart(E)` | `dayStart(E+1)` |
 * | `@DT10:00` | D 10:00 | an hour later |
 * | `@DT10:00>11:00` | D 10:00 | D 11:00, the next day's when before the start |
 * | `@DT10:00>D`, `@DT22:00>E` | the written start | `dayStart(E+1)` |
 * | `@>ET17:00`, `@>>DT17:00` | an hour before the end | the written end |
 * | `@>>D` | `dayStart(D)` | `dayStart(D+1)` |
 *
 * A task with only a due is read as if the due were its end (`spanDates`).
 * A time inherited from the section or the note is a written time. The rows
 * rule 4 calls errors (`@D>ET10:00`, `@>ET17:00`, `@D>DT02:00`) are not
 * drawn; they are read by the same rules and not mended (`@D>DT02:00` ends
 * before it starts), for the API's `includeInvalid`.
 */
export function resolveSpan(stated: StatedDates, startHour: number): ResolvedSpan {
    return { span: spanOf(spanDates(stated), startHour), dueMs: dueMsOf(stated.due, startHour) };
}

function spanOf(dates: StatedDates, startHour: number): TaskSpan | null {
    const span = rawSpanOf(dates, startHour);
    return span && Number.isFinite(span.startMs) && Number.isFinite(span.endMs) ? span : null;
}

function rawSpanOf(dates: StatedDates, startHour: number): TaskSpan | null {
    const { startDate, startTime, endDate, endTime } = dates;
    /** The end of the visual day `day`. */
    const endOf = (day: string) => dayStart(DateUtils.addDays(day, 1), startHour);

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
        // A bare end date: that whole day.
        return { startMs: dayStart(endDate, startHour), endMs: endOf(endDate) };
    }

    const start = startTime ? DateUtils.timeToMinutes(startTime) : startHour * 60;
    const startMs = instantAt(startDate, start);

    if (!endDate) {
        if (endTime) {
            const end = DateUtils.timeToMinutes(endTime);
            return { startMs, endMs: instantAt(end < start ? DateUtils.addDays(startDate, 1) : startDate, end) };
        }
        if (startTime) return { startMs, endMs: instantAt(startDate, start + DateUtils.DEFAULT_TIMED_DURATION_MINUTES) };
        return { startMs, endMs: endOf(startDate) };
    }

    // A written end date: its written time, or the end of that day.
    return { startMs, endMs: endTime ? instantAt(endDate, DateUtils.timeToMinutes(endTime)) : endOf(endDate) };
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

    // A side rests on a bare date when no time stands behind it. A task with
    // only a due rests on the due (`spanDates`).
    const dates = spanDates(stated);
    const bareStart = dates.startDate ? !dates.startTime : !dates.endTime;
    const bareEnd = !dates.endTime && (!!dates.endDate || !dates.startTime);
    const start = instantText(span.startMs);
    const end = instantText(span.endMs);

    return {
        start: side(task.startDate, task.startTime, stated.startDate, stated.startTime,
            bareStart ? visualDayOf(span.startMs, startHour) : start.date,
            bareStart ? undefined : start.time),
        end: side(task.endDate, task.endTime, stated.endDate, stated.endTime,
            bareEnd ? endDayOf(span.endMs, startHour) : end.date,
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
