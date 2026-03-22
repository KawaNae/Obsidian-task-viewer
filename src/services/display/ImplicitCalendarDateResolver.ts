/**
 * Storage-layer implicit date resolution for tasks inside daily notes.
 * Display-layer implicit resolution is handled by DisplayTaskConverter.toDisplayTask().
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
}
