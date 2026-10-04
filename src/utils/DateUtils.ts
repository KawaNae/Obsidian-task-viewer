import type { TimeOfDay } from '../types';

/**
 * The date module: every conversion between a `YYYY-MM-DD` string and a
 * `Date`, the visual "today", the start of a week, and shifting by days. A
 * day as a stretch of time is `DayWindow`'s. Pure — the wall clock is read only by the entry points
 * that say so (`getVisualDateOfNow`, `getToday`); everything
 * else takes the moment as an argument.
 *
 * Dates are local calendar days. Years are four digits, as the `@` notation
 * and the expression language's lexer read them: `0026` is the year 26, not
 * 1926, and a year below 1000 is still printed with four digits.
 */
export class DateUtils {
    /** Default duration in minutes for single-sided timed tasks (S-Timed / E-Timed). */
    static readonly DEFAULT_TIMED_DURATION_MINUTES = 60;

    /**
     * The shape of a date, as regex source. Grammars that embed a date (the
     * date block, the Tasks emoji fields, the lexer, segment ids) build their
     * patterns from this, so the shape is written once.
     */
    static readonly DATE_PATTERN = String.raw`\d{4}-\d{2}-\d{2}`;

    /** The shape of an `HH:mm` time, as regex source, for the same grammars. */
    static readonly TIME_PATTERN = String.raw`\d{2}:\d{2}`;

    private static readonly DATE_SHAPE_RE = new RegExp(`^${DateUtils.DATE_PATTERN}$`);
    private static readonly TIME_SHAPE_RE = new RegExp(`^${DateUtils.TIME_PATTERN}$`);

    /** Whether `value` has the `YYYY-MM-DD` shape. Does not ask whether the day exists. */
    static isDateShape(value: string): boolean {
        return DateUtils.DATE_SHAPE_RE.test(value);
    }

    /** Whether `value` has the `HH:mm` shape. Does not ask whether the time exists. */
    static isTimeShape(value: string): boolean {
        return DateUtils.TIME_SHAPE_RE.test(value);
    }

    /**
     * A date built from a year that may have fewer than three digits.
     *
     * `new Date(y, ...)` maps a two-digit year onto 1900 + y. Every
     * construction from a computed or parsed year goes through this, so the
     * shift cannot come back in one of them.
     */
    static dateAt(year: number, monthIndex: number, day: number): Date {
        const date = new Date(year, monthIndex, day);
        if (year >= 0 && year <= 99) date.setFullYear(year);
        return date;
    }

    /**
     * `YYYY-MM-DD` as local midnight (not UTC). The caller vouches for the
     * shape; use {@link readDate} for text that has not been checked.
     */
    static parseDate(dateStr: string): Date {
        const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
        return DateUtils.dateAt(y, m - 1, d);
    }

    /**
     * `YYYY-MM-DD` as local midnight, or null when the text is not that shape
     * or names a day that does not exist (Feb 30, Apr 31, Feb 29 of a
     * non-leap year).
     */
    static readDate(value: string): Date | null {
        if (!DateUtils.isDateShape(value)) return null;
        const date = DateUtils.parseDate(value);
        return DateUtils.getLocalDateString(date) === value ? date : null;
    }

    /** A date and an `HH:mm` time as a local moment. */
    static toDateTime(date: string, time: string): Date {
        const d = DateUtils.parseDate(date);
        const [h, m] = time.split(':').map(n => parseInt(n, 10));
        d.setHours(h, m, 0, 0);
        return d;
    }

    static getLocalDateString(date: Date): string {
        // Four digits like the notation reads; every ordinary year already is.
        const year = date.getFullYear().toString().padStart(4, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /** Day of the week of a `YYYY-MM-DD` date (0 = Sunday, as `Date.getDay`). */
    static weekdayOf(date: string): number {
        return DateUtils.parseDate(date).getDay();
    }

    /** Format hours/minutes as `HH:mm`, zero-padded. */
    static formatHHMM(hours: number, minutes: number): TimeOfDay {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}` as TimeOfDay;
    }

    /**
     * A time a row holds (`Task.startTime`, `endTime`, or the section's), taken
     * for the `HH:mm` it is: the parsers read only that shape (`TIME_PATTERN`),
     * and every writer checks or builds it. The form's preview reads a time
     * still being typed through here too, as it always has.
     */
    static timeOfDay(time: string | undefined): TimeOfDay | undefined {
        return time as TimeOfDay | undefined;
    }

    /**
     * Split a date-time text (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, the shape a
     * due is kept in) into its date and its time.
     */
    static splitDateTime(value: string): { date: string; time?: string } {
        const t = value.indexOf('T');
        if (t === -1) return { date: value };
        const time = value.slice(t + 1);
        return time ? { date: value.slice(0, t), time } : { date: value.slice(0, t) };
    }

    /**
     * Join a date and a time into the one text a due is kept in. No date, no
     * value; a time without a date is dropped.
     */
    static joinDateTime(date: string | undefined, time: string | undefined): string | undefined {
        if (!date) return undefined;
        return time ? `${date}T${time}` : date;
    }

    /**
     * The visual date at `now`: before `startHour` the day still belongs to
     * the previous date.
     */
    static visualDateAt(now: Date, startHour: number): string {
        const visual = new Date(now);
        if (now.getHours() < startHour) {
            visual.setDate(visual.getDate() - 1);
        }
        return DateUtils.getLocalDateString(visual);
    }

    /** The visual date now, on the wall clock. */
    static getVisualDateOfNow(startHour: number): string {
        return DateUtils.visualDateAt(new Date(), startHour);
    }

    /** The calendar date now, on the wall clock (midnight boundary). */
    static getToday(): string {
        return DateUtils.getLocalDateString(new Date());
    }

    static getDiffDays(start: string, end: string): number {
        const d1 = DateUtils.parseDate(start);
        const d2 = DateUtils.parseDate(end);
        const diffTime = d2.getTime() - d1.getTime();
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }

    static addDays(date: string, days: number): string {
        const d = DateUtils.parseDate(date);
        d.setDate(d.getDate() + days);
        return this.getLocalDateString(d);
    }

    /**
     * Returns an array of YYYY-MM-DD strings from start to end (inclusive).
     */
    static getDateRange(start: string, end: string): string[] {
        const days = this.getDiffDays(start, end);
        if (days < 0) return [];
        const result: string[] = [];
        for (let i = 0; i <= days; i++) {
            result.push(this.addDays(start, i));
        }
        return result;
    }

    /**
     * Returns the start-of-week date for the given date, with the configured first-day-of-week.
     * weekStartDay: 0 = Sunday, 1 = Monday. Time component is normalized to local midnight.
     */
    static getWeekStart(date: Date, weekStartDay: 0 | 1): Date {
        const day = date.getDay();
        const diff = (day - weekStartDay + 7) % 7;
        return DateUtils.dateAt(date.getFullYear(), date.getMonth(), date.getDate() - diff);
    }

    /**
     * First date (YYYY-MM-DD) of the month grid that shows `date`'s month: the
     * week start on or before the 1st. Calendar and Mini Calendar anchor their
     * window here.
     */
    static getMonthGridStart(date: Date, weekStartDay: 0 | 1): string {
        const monthStart = DateUtils.dateAt(date.getFullYear(), date.getMonth(), 1);
        return this.getLocalDateString(this.getWeekStart(monthStart, weekStartDay));
    }

    /**
     * Returns a canonical YYYY-MM-DD identifier for the visual week containing `date`,
     * honoring the user's weekStartDay. Two dates yield the same key iff they belong
     * to the same visual week. Used by views that need to group/compare dates by week.
     */
    static getVisualWeekKey(date: Date, weekStartDay: 0 | 1): string {
        return this.getLocalDateString(this.getWeekStart(date, weekStartDay));
    }


    /**
     * Shift a date or date-time (`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`) by whole
     * days, keeping the time. The one way a copy or a next instance moves a
     * date.
     */
    static shiftDateString(dateStr: string, days: number): string {
        const { date, time } = DateUtils.splitDateTime(dateStr);
        return DateUtils.joinDateTime(DateUtils.addDays(date, days), time)!;
    }

    /** `YYYY-MM-DD` naming a day that exists. */
    static isValidDateString(value: string): boolean {
        return DateUtils.readDate(value) !== null;
    }

    static isValidTimeString(value: string): boolean {
        if (!DateUtils.TIME_SHAPE_RE.test(value)) return false;
        const [h, m] = value.split(':').map(Number);
        return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    }

    static timeToMinutes(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    static minutesToTime(minutes: number): TimeOfDay {
        let m = Math.round(minutes);
        if (m < 0) m = 0;
        while (m >= 24 * 60) m -= 24 * 60;
        const h = Math.floor(m / 60);
        const min = m % 60;
        return DateUtils.formatHHMM(h, min);
    }

    static dueDatePart(due: string | undefined): string | undefined {
        if (!due) return undefined;
        return DateUtils.splitDateTime(due).date;
    }
}
