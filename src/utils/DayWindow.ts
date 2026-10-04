import type { TaskSpan } from '../types';
import { DEFAULT_NEXT_N_DAYS, type DateFilterValue } from '../services/filter/FilterTypes';
import { DateUtils } from './DateUtils';

/**
 * Days as stretches of time, and moments as days: the one place a visual
 * day (`startHour`) meets the clock.
 *
 * A visual day D is `[dayStart(D), dayStart(D+1))`, where `dayStart(D)` is
 * D at `startHour:00`. Several days, a date a filter names and a preset are
 * windows of such days (`daysWindow`, `ofValue`); the day a moment falls in
 * is `visualDayOf`, and the days a span is drawn over are `visualDaysOf`.
 * Moments are local epoch milliseconds. A step across days moves the date
 * and then puts the time on it, so a day of a clock change counts as one day.
 */

/** A stretch of time, `[startMs, endMs)`, as a filter's date or a view's days are. */
export interface TimeWindow {
    startMs: number;
    endMs: number;
}

/** What a relative value counts from: the week's first day, the day's first hour, and now. */
export interface WindowContext {
    readonly weekStartDay: 0 | 1;
    readonly startHour: number;
    readonly now: Date;
}

const MINUTES_PER_DAY = 24 * 60;

/** The moment `minutes` after midnight of `date`, on the wall clock; minutes past a day step into the next. */
export function instantAt(date: string, minutes: number): number {
    const days = Math.floor(minutes / MINUTES_PER_DAY);
    const rest = minutes - days * MINUTES_PER_DAY;
    const d = DateUtils.parseDate(days === 0 ? date : DateUtils.addDays(date, days));
    d.setHours(Math.floor(rest / 60), rest % 60, 0, 0);
    return d.getTime();
}

/** The moment the visual day `day` starts: `day` at `startHour:00`. */
export function dayStart(day: string, startHour: number): number {
    return instantAt(day, startHour * 60);
}

/** The visual days `from` to `to`, both included: `[dayStart(from), dayStart(to + 1))`. */
export function daysWindow(from: string, to: string, startHour: number): TimeWindow {
    return { startMs: dayStart(from, startHour), endMs: dayStart(DateUtils.addDays(to, 1), startHour) };
}

/** The visual day the moment falls in. */
export function visualDayOf(ms: number, startHour: number): string {
    return DateUtils.visualDateAt(new Date(ms), startHour);
}

/**
 * The first and the last visual day a span is drawn over. The last is the
 * day of the moment before the end, so a span that ends right at a day's
 * start does not reach that day; a point is drawn on its day. The one place
 * an end becomes a day.
 */
export function visualDaysOf(span: TaskSpan, startHour: number): { first: string; last: string } {
    const first = visualDayOf(span.startMs, startHour);
    if (span.endMs <= span.startMs) return { first, last: first };
    return { first, last: visualDayOf(span.endMs - 1, startHour) };
}

/**
 * Minutes from the start of the visual day `day` to the moment, read on the
 * wall clock (a moment on the next date adds a day of minutes), so a day of a
 * clock change keeps to the grid of hours.
 */
export function minutesInDay(ms: number, day: string, startHour: number): number {
    const d = new Date(ms);
    const days = DateUtils.getDiffDays(day, DateUtils.getLocalDateString(d));
    return days * MINUTES_PER_DAY + d.getHours() * 60 + d.getMinutes() - startHour * 60;
}

/**
 * Where a span sits in the visual day it starts on: its start and end in
 * {@link minutesInDay} of that day. The time grid's layout, its card
 * placement and the render order all read this, so their stacking agrees.
 */
export function minutesOfSpan(span: TaskSpan, startHour: number): { start: number; end: number } {
    const day = visualDayOf(span.startMs, startHour);
    return { start: minutesInDay(span.startMs, day, startHour), end: minutesInDay(span.endMs, day, startHour) };
}

/** The moment as the calendar date and the `HH:mm` time on the wall clock. */
export function instantText(ms: number): { date: string; time: string } {
    const d = new Date(ms);
    return { date: DateUtils.getLocalDateString(d), time: DateUtils.formatHHMM(d.getHours(), d.getMinutes()) };
}

/**
 * The window a filter's date value names: a date is its visual day, a preset
 * the visual days it counts from the visual day at `now`.
 */
export function ofValue(value: DateFilterValue, ctx: WindowContext): TimeWindow {
    const { from, to } = daysOfValue(value, ctx);
    return daysWindow(from, to, ctx.startHour);
}

function daysOfValue(value: DateFilterValue, ctx: WindowContext): { from: string; to: string } {
    if (typeof value === 'string') return { from: value, to: value };

    const today = DateUtils.visualDateAt(ctx.now, ctx.startHour);
    const week = (anyDay: string) => {
        const from = DateUtils.getLocalDateString(DateUtils.getWeekStart(DateUtils.parseDate(anyDay), ctx.weekStartDay));
        return { from, to: DateUtils.addDays(from, 6) };
    };

    switch (value.preset) {
        case 'thisWeek':
            return week(today);
        case 'nextWeek':
            return week(DateUtils.addDays(today, 7));
        case 'pastWeek':
            return week(DateUtils.addDays(today, -7));
        case 'nextNDays': {
            const n = value.n ?? DEFAULT_NEXT_N_DAYS;
            return { from: today, to: DateUtils.addDays(today, n - 1) };
        }
        case 'thisMonth': {
            const d = DateUtils.parseDate(today);
            return {
                from: DateUtils.getLocalDateString(DateUtils.dateAt(d.getFullYear(), d.getMonth(), 1)),
                to: DateUtils.getLocalDateString(DateUtils.dateAt(d.getFullYear(), d.getMonth() + 1, 0)),
            };
        }
        case 'thisYear': {
            const year = DateUtils.parseDate(today).getFullYear();
            return {
                from: DateUtils.getLocalDateString(DateUtils.dateAt(year, 0, 1)),
                to: DateUtils.getLocalDateString(DateUtils.dateAt(year, 11, 31)),
            };
        }
        case 'today':
        default:
            return { from: today, to: today };
    }
}
