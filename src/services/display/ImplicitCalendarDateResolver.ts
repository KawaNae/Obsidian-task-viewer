/**
 * Storage-layer implicit date resolution for tasks inside daily notes.
 * Display-layer implicit resolution is handled by DisplayTaskConverter.toDisplayTask().
 */
export class ImplicitCalendarDateResolver {
    /**
     * Resolve implicit dates for tasks inside a daily note.
     *
     * Inherits the daily note's date into startDate when the task has no
     * other date anchor (no endDate, endTime, or due). Covers two cases:
     *  - the task has startTime only (time-only inline notation), or
     *  - the task has no scheduling at all (bare `- [ ]` checkbox).
     *
     * Returns only the fields that need to be overwritten (sparse update).
     */
    static resolveDailyNoteDates(
        task: { startDate?: string; startTime?: string; endDate?: string; endTime?: string; due?: string },
        dailyNoteDate: string
    ): { startDate?: string; startDateInherited?: boolean } {
        const result: { startDate?: string; startDateInherited?: boolean } = {};
        if (task.startDate) return result;

        const isBareCheckbox = !task.startTime && !task.endDate && !task.endTime && !task.due;
        if (task.startTime || isBareCheckbox) {
            result.startDate = dailyNoteDate;
            result.startDateInherited = true;
        }
        // endDate resolution is handled by DisplayTaskConverter (implicit endDate from startDate)

        return result;
    }
}
