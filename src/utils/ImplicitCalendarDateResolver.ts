import { DateUtils } from './DateUtils';

/**
 * Implicit calendar date resolution for both storage and display layers.
 * Centralizes rules for inheriting/deriving calendar dates (YYYY-MM-DD / HH:mm)
 * when fields are omitted. Distinct from visual day boundary calculations (DateUtils).
 */
export class ImplicitCalendarDateResolver {
    /**
     * Resolve implicit End Date.
     * When endDate is unset but endTime exists, inherit from startDate (same-day inference).
     */
    static resolveEndDate(
        endDate: string | undefined,
        endTime: string | undefined,
        startDate: string | undefined
    ): string | undefined {
        if (!endDate && endTime && startDate) {
            return startDate;
        }
        return endDate;
    }

    /**
     * Resolve implicit dates for tasks inside a daily note.
     * When startDate is unset but startTime exists, inherit from the daily note's date.
     * Returns only the fields that need to be overwritten (sparse update).
     */
    static resolveDailyNoteDates(
        task: { startDate?: string; startTime?: string; endDate?: string; endTime?: string },
        dailyNoteDate: string
    ): { startDate?: string; startDateInherited?: boolean; endDate?: string } {
        const result: { startDate?: string; startDateInherited?: boolean; endDate?: string } = {};

        if (!task.startDate && task.startTime) {
            result.startDate = dailyNoteDate;
            result.startDateInherited = true;
        }
        if (!task.endDate && task.endTime) {
            result.endDate = task.startDate || dailyNoteDate;
        }

        return result;
    }

    /**
     * Derive implicit start for E/ED type tasks (endDate exists, startDate does not).
     * Symmetric with S/SD default duration rules:
     * - E-Timed: startDate=endDate, startTime=endTime−1h (inverse of S-Timed +1h)
     * - E-AllDay: startDate=endDate (same day, symmetric with S-AllDay single-day display)
     *
     * @returns Implicit start fields, or null if task already has startDate or has no endDate (D type).
     */
    static resolveImplicitStart(
        task: { startDate?: string; startTime?: string; endDate?: string; endTime?: string },
        _startHour: number
    ): { startDate: string; startTime?: string } | null {
        if (task.startDate) return null;
        if (!task.endDate) return null;

        if (task.endTime) {
            // E-Timed: 1 hour before endTime
            const endMinutes = DateUtils.timeToMinutes(task.endTime);
            const startMinutes = endMinutes - 60;
            if (startMinutes >= 0) {
                return {
                    startDate: task.endDate,
                    startTime: DateUtils.minutesToTime(startMinutes),
                };
            }
            // Crosses midnight (e.g. endTime=00:30 → startTime=23:30 previous day)
            return {
                startDate: DateUtils.addDays(task.endDate, -1),
                startTime: DateUtils.minutesToTime(startMinutes + 24 * 60),
            };
        }

        // E-AllDay: same day (symmetric with S-AllDay single-day display)
        return {
            startDate: task.endDate,
        };
    }
}
