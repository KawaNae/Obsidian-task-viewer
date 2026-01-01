export class DateUtils {
    static getLocalDateString(date: Date): string {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    static getVisualDateOfNow(startHour: number): string {
        const now = new Date();
        let visualDateOfNow = new Date(now);
        const currentHour = now.getHours();

        console.log(`[DEBUG] getVisualDateOfNow - current time: ${now.toISOString()}`);
        console.log(`[DEBUG] getVisualDateOfNow - current hour: ${currentHour}, startHour: ${startHour}`);

        if (currentHour < startHour) {
            visualDateOfNow.setDate(visualDateOfNow.getDate() - 1);
            console.log('[DEBUG] getVisualDateOfNow - hour < startHour, using previous day');
        } else {
            console.log('[DEBUG] getVisualDateOfNow - hour >= startHour, using current day');
        }

        const result = this.getLocalDateString(visualDateOfNow);
        console.log(`[DEBUG] getVisualDateOfNow - result: ${result}`);
        return result;
    }

    static getToday(): string {
        return this.getLocalDateString(new Date());
    }

    static getDiffDays(start: string, end: string): number {
        const d1 = new Date(start);
        const d2 = new Date(end);
        const diffTime = d2.getTime() - d1.getTime();
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }

    static addDays(date: string, days: number): string {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        return this.getLocalDateString(d);
    }

    static timeToMinutes(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    static minutesToTime(minutes: number): string {
        let m = Math.round(minutes);
        if (m < 0) m = 0;
        while (m >= 24 * 60) m -= 24 * 60;
        const h = Math.floor(m / 60);
        const min = m % 60;
        return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    }

    /**
     * Calculate task duration in milliseconds based on README spec.
     * Returns the duration considering start/end dates and times.
     * 
     * @param startDate YYYY-MM-DD
     * @param startTime HH:mm or undefined
     * @param endDate YYYY-MM-DD or undefined
     * @param endTime HH:mm or full ISO string or undefined
     * @param startHour The configured start hour for visual day
     * @returns Duration in milliseconds
     */
    static getTaskDurationMs(
        startDate: string,
        startTime: string | undefined,
        endDate: string | undefined,
        endTime: string | undefined,
        startHour: number
    ): number {
        const startHourStr = startHour.toString().padStart(2, '0') + ':00';

        // Calculate effective start datetime
        const effectiveStartTime = startTime || startHourStr;
        const startDateTime = new Date(`${startDate}T${effectiveStartTime}`);

        // Calculate effective end datetime
        let endDateTime: Date;

        if (endTime) {
            if (endTime.includes('T')) {
                // Full ISO format
                endDateTime = new Date(endTime);
            } else {
                // HH:mm format
                const effectiveEndDate = endDate || startDate;
                endDateTime = new Date(`${effectiveEndDate}T${endTime}`);
                // If end is before start, assume next day
                if (endDateTime <= startDateTime) {
                    endDateTime.setDate(endDateTime.getDate() + 1);
                }
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
                endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);
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
     * Check if a task duration is 24 hours or more
     */
    static isAllDayTask(
        startDate: string,
        startTime: string | undefined,
        endDate: string | undefined,
        endTime: string | undefined,
        startHour: number
    ): boolean {
        // Tasks without start time are always considered All Day
        // This covers S-All, SD, ED, E, D types per README spec
        if (!startTime) return true;

        const durationMs = this.getTaskDurationMs(startDate, startTime, endDate, endTime, startHour);
        const hours24 = 24 * 60 * 60 * 1000;
        return durationMs >= hours24;
    }
}
