import type { DateFilterValue } from './FilterTypes';

/**
 * Resolves a DateFilterValue to concrete { start, end } YYYY-MM-DD boundaries.
 * Range presets (thisWeek, nextNDays) return inclusive ranges.
 * Point presets (today) and absolute dates return start === end.
 */
export class DateResolver {
    static resolve(value: DateFilterValue, weekStartDay: 0 | 1 = 1): { start: string; end: string } {
        if (value.mode === 'absolute') {
            return { start: value.date, end: value.date };
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        switch (value.preset) {
            case 'today':
                return { start: toISO(today), end: toISO(today) };

            case 'thisWeek': {
                const { monday, sunday } = getWeekBounds(today, weekStartDay);
                return { start: toISO(monday), end: toISO(sunday) };
            }

            case 'nextWeek': {
                const next = new Date(today);
                next.setDate(next.getDate() + 7);
                const { monday, sunday } = getWeekBounds(next, weekStartDay);
                return { start: toISO(monday), end: toISO(sunday) };
            }

            case 'pastWeek': {
                const past = new Date(today);
                past.setDate(past.getDate() - 7);
                const { monday, sunday } = getWeekBounds(past, weekStartDay);
                return { start: toISO(monday), end: toISO(sunday) };
            }

            case 'nextNDays': {
                const n = value.n ?? 7;
                const end = new Date(today);
                end.setDate(end.getDate() + n - 1);
                return { start: toISO(today), end: toISO(end) };
            }

            default:
                return { start: toISO(today), end: toISO(today) };
        }
    }
}

/** Format Date as YYYY-MM-DD */
function toISO(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
