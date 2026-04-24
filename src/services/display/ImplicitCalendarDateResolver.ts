/**
 * Storage-layer implicit date resolution for tasks inside daily notes.
 * Display-layer implicit resolution is handled by DisplayTaskConverter.toDisplayTask().
 */
export class ImplicitCalendarDateResolver {
    /**
     * Resolve implicit dates for tasks inside a daily note.
     *
     * Inherits the daily note's date into startDate when either:
     *  - the task has startTime but no startDate (time-only inline notation), or
     *  - the task is a plain checkbox with no scheduling at all.
     *
     * The second case keeps "plain `- [ ]` in today's daily note" meaningful
     * as today's task rather than an inbox-anywhere item.
     *
     * Returns only the fields that need to be overwritten (sparse update).
     */
    static resolveDailyNoteDates(
        task: { parserId?: string; startDate?: string; startTime?: string; endDate?: string; endTime?: string },
        dailyNoteDate: string
    ): { startDate?: string; startDateInherited?: boolean } {
        const result: { startDate?: string; startDateInherited?: boolean } = {};

        if (!task.startDate && (task.startTime || task.parserId === 'plain')) {
            result.startDate = dailyNoteDate;
            result.startDateInherited = true;
        }
        // endDate resolution is handled by DisplayTaskConverter (implicit endDate from startDate)

        return result;
    }
}
