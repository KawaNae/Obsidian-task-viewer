import type { DisplayTask, TimeOfDay } from '../types';

/**
 * The date module: every conversion between a `YYYY-MM-DD` string and a
 * `Date`, the visual "today", the start of a week, shifting by days, and the
 * length of a task. Pure — the wall clock is read only by the entry points
 * that say so (`getVisualDateOfNow`, `getToday`, `isPastDate`); everything
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
     * Get the visual start date for a task considering startHour.
     * If a task's startTime is before startHour, it visually belongs to the previous day.
     * 
     * @param date YYYY-MM-DD - The calendar date
     * @param time HH:mm or undefined - The time component
     * @param startHour The configured start hour for visual day (e.g., 5 for 5:00 AM)
     * @returns The visual date YYYY-MM-DD
     */
    static toVisualDate(date: string, time: string | undefined, startHour: number): string {
        if (!time) return date;  // All-day tasks use actual date

        const [h] = time.split(':').map(Number);
        if (h < startHour) {
            // time is before startHour → visually belongs to previous day
            return this.addDays(date, -1);
        }
        return date;
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

    /**
     * Calculate task duration in milliseconds based on README spec.
     * Returns the duration considering start/end dates and times.
     *
     * @param startDate YYYY-MM-DD
     * @param startTime HH:mm or undefined
     * @param endDate YYYY-MM-DD or undefined
     * @param endTime HH:mm or undefined
     * @param startHour The configured start hour for visual day
     * @returns Duration in milliseconds
     */
    static getTaskDurationMs(
        startDate: string,
        startTime: TimeOfDay | undefined,
        endDate: string | undefined,
        endTime: TimeOfDay | undefined,
        startHour: number
    ): number {
        const startHourStr = startHour.toString().padStart(2, '0') + ':00';

        // Calculate effective start datetime
        const effectiveStartTime = startTime || startHourStr;
        const startDateTime = new Date(`${startDate}T${effectiveStartTime}`);

        // Calculate effective end datetime
        let endDateTime: Date;

        if (endTime) {
            const effectiveEndDate = endDate || startDate;
            endDateTime = new Date(`${effectiveEndDate}T${endTime}`);
            // If end is strictly before start, assume next day
            // Note: end == start means 0 duration, not 24 hours
            if (endDateTime < startDateTime) {
                endDateTime.setDate(endDateTime.getDate() + 1);
            }
        } else if (endDate && endDate !== startDate) {
            // Different end date, no end time: end at startHour-1:59 of end date
            let endHour = startHour - 1;
            if (endHour < 0) endHour = 23;
            endDateTime = new Date(`${endDate}T${endHour.toString().padStart(2, '0')}:59`);
        } else {
            // Same date or no end date: depends on whether there's a start time
            if (startTime) {
                // S-Timed: +1 hour
                endDateTime = new Date(startDateTime.getTime() + DateUtils.DEFAULT_TIMED_DURATION_MINUTES * 60 * 1000);
            } else {
                // S-All, SD, etc: next day at startHour-1:59 (24 hours)
                const nextDay = this.addDays(startDate, 1);
                let endHour = startHour - 1;
                if (endHour < 0) endHour = 23;
                endDateTime = new Date(`${nextDay}T${endHour.toString().padStart(2, '0')}:59`);
            }
        }

        return endDateTime.getTime() - startDateTime.getTime();
    }

    /**
     * How long a task lasts, from its effective start (date and time) to its
     * effective end. null for a task without a start (due only), or whose end
     * comes before its start.
     *
     * The filter's `length` and the API's `durationMinutes` both read this, so
     * a task that `length greaterThan 24 hours` picks up reports the same span.
     */
    static getDisplayTaskDurationMs(
        task: Pick<DisplayTask, 'effectiveStartDate' | 'effectiveStartTime' | 'effectiveEndDate' | 'effectiveEndTime'>,
        startHour: number,
    ): number | null {
        if (!task.effectiveStartDate) return null;
        const ms = DateUtils.getTaskDurationMs(
            task.effectiveStartDate, task.effectiveStartTime,
            task.effectiveEndDate, task.effectiveEndTime,
            startHour,
        );
        return Number.isFinite(ms) && ms >= 0 ? ms : null;
    }

    /**
     * Minutes of an `HH:mm` time counted from midnight of the visual day's
     * calendar date: a time before `startHour` belongs to the early morning
     * after it, so it lands past 24:00.
     */
    static visualDayMinutes(time: string, startHour: number): number {
        const minutes = DateUtils.timeToMinutes(time);
        return minutes < startHour * 60 ? minutes + 24 * 60 : minutes;
    }

    /**
     * Where a timed task sits in its visual day: start and end in
     * {@link visualDayMinutes}. An end that reads before the start is the next
     * day's; no end means the default length. The timeline's layout, its card
     * placement and the render order all read this, so their stacking agrees.
     */
    static timedSpanMinutes(
        startTime: string, endTime: string | undefined, startHour: number,
    ): { start: number; end: number } {
        const start = DateUtils.visualDayMinutes(startTime, startHour);
        if (!endTime) return { start, end: start + DateUtils.DEFAULT_TIMED_DURATION_MINUTES };
        let end = DateUtils.visualDayMinutes(endTime, startHour);
        if (end < start) end += 24 * 60;
        return { start, end };
    }

    /**
     * Check if a task duration is 24 hours or more
     */
    static isAllDayTask(
        startDate: string,
        startTime: TimeOfDay | undefined,
        endDate: string | undefined,
        endTime: TimeOfDay | undefined,
        startHour: number
    ): boolean {
        // Tasks without start time are always considered All Day
        // This covers S-All, SD, ED, E, D types per README spec
        if (!startTime) return true;

        const durationMs = this.getTaskDurationMs(startDate, startTime, endDate, endTime, startHour);
        const threshold = 23.5 * 60 * 60 * 1000; // 23h30m
        return durationMs >= threshold;
    }

    /**
     * Check if a date/time is in the past considering startHour.
     * For visual date boundary: if current time < startHour, yesterday is considered "today".
     * 
     * @param dateStr YYYY-MM-DD - The date to check
     * @param timeStr HH:mm or undefined - The time to check (optional)
     * @param startHour The configured start hour for visual day boundary
     * @returns true if the date/time is in the past
     */
    static isPastDate(dateStr: string, timeStr: string | undefined, startHour: number): boolean {
        const now = new Date();
        const visualToday = this.getVisualDateOfNow(startHour);
        const taskVisualDate = this.toVisualDate(dateStr, timeStr, startHour);

        if (taskVisualDate < visualToday) return true;
        if (taskVisualDate > visualToday) return false;

        // Same visual date - compare in visual-day-relative minutes
        if (timeStr) {
            const startMinutes = startHour * 60;
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const taskMinutes = this.timeToMinutes(timeStr);
            const currentVisual = (currentMinutes - startMinutes + 1440) % 1440;
            const taskVisual = (taskMinutes - startMinutes + 1440) % 1440;
            return taskVisual < currentVisual;
        }

        // Same date, no time specified - not past yet (it's "today")
        return false;
    }

    /**
     * Check if a due date is in the past considering startHour.
     *
     * @param due YYYY-MM-DD or YYYY-MM-DDTHH:mm format
     * @param startHour The configured start hour for visual day boundary
     * @returns true if the due date is in the past
     */
    static isPastDue(due: string, startHour: number): boolean {
        const { date, time } = DateUtils.splitDateTime(due);
        return this.isPastDate(date, time, startHour);
    }

    static dueDatePart(due: string | undefined): string | undefined {
        if (!due) return undefined;
        return DateUtils.splitDateTime(due).date;
    }
}
