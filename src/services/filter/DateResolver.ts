import { DateUtils } from '../../utils/DateUtils';
import type { DateFilterValue } from './FilterTypes';

/**
 * Resolves a DateFilterValue to concrete { start, end } YYYY-MM-DD boundaries.
 * Range presets (thisWeek, nextNDays) return inclusive ranges.
 * Point presets (today) and absolute dates return start === end.
 */
export class DateResolver {
    static resolve(value: DateFilterValue, weekStartDay: 0 | 1, startHour: number): { start: string; end: string } {
        if (typeof value === 'string') {
            return { start: value, end: value };
        }

        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        // Shift to visual "today" when before startHour boundary
        if (now.getHours() < startHour) {
            today.setDate(today.getDate() - 1);
        }

        switch (value.preset) {
            case 'today':
                return { start: DateUtils.getLocalDateString(today), end: DateUtils.getLocalDateString(today) };

            case 'thisWeek': {
                const { monday, sunday } = getWeekBounds(today, weekStartDay);
                return { start: DateUtils.getLocalDateString(monday), end: DateUtils.getLocalDateString(sunday) };
            }

            case 'nextWeek': {
                const next = new Date(today);
                next.setDate(next.getDate() + 7);
                const { monday, sunday } = getWeekBounds(next, weekStartDay);
                return { start: DateUtils.getLocalDateString(monday), end: DateUtils.getLocalDateString(sunday) };
            }

            case 'pastWeek': {
                const past = new Date(today);
                past.setDate(past.getDate() - 7);
                const { monday, sunday } = getWeekBounds(past, weekStartDay);
                return { start: DateUtils.getLocalDateString(monday), end: DateUtils.getLocalDateString(sunday) };
            }

            case 'nextNDays': {
                const n = value.n ?? 7;
                const end = new Date(today);
                end.setDate(end.getDate() + n - 1);
                return { start: DateUtils.getLocalDateString(today), end: DateUtils.getLocalDateString(end) };
            }

            case 'thisMonth': {
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                return { start: DateUtils.getLocalDateString(monthStart), end: DateUtils.getLocalDateString(monthEnd) };
            }

            case 'thisYear': {
                const yearStart = new Date(today.getFullYear(), 0, 1);
                const yearEnd = new Date(today.getFullYear(), 11, 31);
                return { start: DateUtils.getLocalDateString(yearStart), end: DateUtils.getLocalDateString(yearEnd) };
            }

            default:
                return { start: DateUtils.getLocalDateString(today), end: DateUtils.getLocalDateString(today) };
        }
    }
}

/** Get the week start (monday) and end (sunday) containing the given date */
function getWeekBounds(date: Date, weekStartDay: 0 | 1): { monday: Date; sunday: Date } {
    const d = new Date(date);
    const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ...

    const start = new Date(d);
    if (weekStartDay === 1) {
        // Monday start: offset = (dayOfWeek + 6) % 7
        start.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
    } else {
        // Sunday start: offset = dayOfWeek
        start.setDate(d.getDate() - dayOfWeek);
    }

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    return { monday: start, sunday: end };
}
