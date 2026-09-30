import { DateUtils } from '../../utils/DateUtils';
import { DEFAULT_NEXT_N_DAYS, type DateFilterValue } from './FilterTypes';

/**
 * Resolves a DateFilterValue to concrete { start, end } YYYY-MM-DD boundaries.
 * Range presets (thisWeek, nextNDays) return inclusive ranges.
 * Point presets (today) and absolute dates return start === end.
 *
 * Relative presets count from the visual date at `now` (the caller's clock).
 */
export class DateResolver {
    static resolve(
        value: DateFilterValue, weekStartDay: 0 | 1, startHour: number, now: Date,
    ): { start: string; end: string } {
        if (typeof value === 'string') {
            return { start: value, end: value };
        }

        const today = DateUtils.visualDateAt(now, startHour);
        const week = (anyDay: string) => {
            const start = DateUtils.getLocalDateString(DateUtils.getWeekStart(DateUtils.parseDate(anyDay), weekStartDay));
            return { start, end: DateUtils.addDays(start, 6) };
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
                return { start: today, end: DateUtils.addDays(today, n - 1) };
            }
            case 'thisMonth': {
                const d = DateUtils.parseDate(today);
                return {
                    start: DateUtils.getLocalDateString(DateUtils.dateAt(d.getFullYear(), d.getMonth(), 1)),
                    end: DateUtils.getLocalDateString(DateUtils.dateAt(d.getFullYear(), d.getMonth() + 1, 0)),
                };
            }
            case 'thisYear': {
                const year = DateUtils.parseDate(today).getFullYear();
                return {
                    start: DateUtils.getLocalDateString(DateUtils.dateAt(year, 0, 1)),
                    end: DateUtils.getLocalDateString(DateUtils.dateAt(year, 11, 31)),
                };
            }
            case 'today':
            default:
                return { start: today, end: today };
        }
    }
}
