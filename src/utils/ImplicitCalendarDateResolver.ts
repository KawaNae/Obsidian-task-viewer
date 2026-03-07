import { DateUtils } from './DateUtils';

/**
 * Implicit calendar date resolution for both storage and display layers.
 * Centralizes rules for inheriting/deriving calendar dates (YYYY-MM-DD / HH:mm)
 * when fields are omitted. Distinct from visual day boundary calculations (DateUtils).
 */
export class ImplicitCalendarDateResolver {
    /**
     * Resolve implicit dates for tasks inside a daily note.
     * When startDate is unset but startTime exists, inherit from the daily note's date.
     * Returns only the fields that need to be overwritten (sparse update).
     */
    static resolveDailyNoteDates(
        task: { startDate?: string; startTime?: string; endDate?: string; endTime?: string },
        dailyNoteDate: string
    ): { startDate?: string; startDateInherited?: boolean } {
        const result: { startDate?: string; startDateInherited?: boolean } = {};

        if (!task.startDate && task.startTime) {
            result.startDate = dailyNoteDate;
            result.startDateInherited = true;
        }
        // endDate resolution is handled by DisplayTaskConverter (implicit endDate from startDate)

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
            const startMinutes = endMinutes - DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
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

    /**
     * Derive implicit end for S/SD type tasks (startDate exists, endDate does not).
     * Symmetric with resolveImplicitStart():
     * - S-Timed: endDate=startDate, endTime=startTime+DEFAULT_TIMED_DURATION_MINUTES
     * - S-AllDay: endDate=startDate+1day (same visual-day duration)
     *
     * @returns Implicit end fields, or null if task already has endDate or has no startDate.
     */
    static resolveImplicitEnd(
        task: { startDate?: string; startTime?: string; endDate?: string; endTime?: string },
        startHour: number
    ): { endDate: string; endTime?: string } | null {
        if (task.endDate) return null;
        if (!task.startDate) return null;

        if (task.startTime) {
            // S-Timed: DEFAULT_TIMED_DURATION_MINUTES after startTime
            const startMinutes = DateUtils.timeToMinutes(task.startTime);
            const endMinutes = startMinutes + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
            if (endMinutes < 24 * 60) {
                return {
                    endDate: task.startDate,
                    endTime: DateUtils.minutesToTime(endMinutes),
                };
            }
            // Crosses midnight
            return {
                endDate: DateUtils.addDays(task.startDate, 1),
                endTime: DateUtils.minutesToTime(endMinutes - 24 * 60),
            };
        }

        // S-AllDay: next day at (startHour-1):59
        let endHour = startHour - 1;
        if (endHour < 0) endHour = 23;
        return {
            endDate: DateUtils.addDays(task.startDate, 1),
            endTime: `${endHour.toString().padStart(2, '0')}:59`,
        };
    }
}
