export class DateUtils {
    static getLocalDateString(date: Date): string {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    static getVisualDateOfNow(startHour: number): string {
        const now = new Date();
        const visualDateOfNow = new Date(now);

        if (now.getHours() < startHour) {
            visualDateOfNow.setDate(visualDateOfNow.getDate() - 1);
        }

        return this.getLocalDateString(visualDateOfNow);
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

    /**
     * Returns ISO-8601 week number (1-53) for the given date.
     */
    static getISOWeekNumber(date: Date): number {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    }

    /**
     * Get the visual start date for a task considering startHour.
     * If a task's startTime is before startHour, it visually belongs to the previous day.
     * 
     * @param startDate YYYY-MM-DD - The task's actual start date
     * @param startTime HH:mm or undefined - The task's start time
     * @param startHour The configured start hour for visual day (e.g., 5 for 5:00 AM)
     * @returns The visual date YYYY-MM-DD
     */
    static getVisualStartDate(startDate: string, startTime: string | undefined, startHour: number): string {
        if (!startTime) return startDate;  // All-day tasks use actual date

        const [h] = startTime.split(':').map(Number);
        if (h < startHour) {
            // startTime is before startHour → visually belongs to previous day
            return this.addDays(startDate, -1);
        }
        return startDate;
    }

    /**
     * 日時文字列を指定日数シフト（時刻部分は保持）
     * @param dateStr YYYY-MM-DD or YYYY-MM-DDTHH:mm
     * @param days シフトする日数
     * @returns シフト後の日時文字列
     */
    static shiftDateString(dateStr: string, days: number): string {
        const hasTime = dateStr.includes('T');
        const datePart = dateStr.split('T')[0];
        const timePart = hasTime ? dateStr.split('T')[1] : null;

        const newDateStr = this.addDays(datePart, days);
        return timePart ? `${newDateStr}T${timePart}` : newDateStr;
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
                // If end is strictly before start, assume next day
                // Note: end == start means 0 duration, not 24 hours
                if (endDateTime < startDateTime) {
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

        // Compare the date part first
        if (dateStr < visualToday) {
            return true;
        }

        if (dateStr > visualToday) {
            return false;
        }

        // Same visual date - check time if provided
        if (timeStr) {
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const currentMinutes = currentHour * 60 + currentMinute;
            const taskMinutes = this.timeToMinutes(timeStr);
            return taskMinutes < currentMinutes;
        }

        // Same date, no time specified - not past yet (it's "today")
        return false;
    }

    /**
     * Check if a deadline is in the past considering startHour.
     * 
     * @param deadline YYYY-MM-DD or YYYY-MM-DDTHH:mm format
     * @param startHour The configured start hour for visual day boundary
     * @returns true if the deadline is in the past
     */
    static isPastDeadline(deadline: string, startHour: number): boolean {
        const hasTime = deadline.includes('T');
        const datePart = deadline.split('T')[0];
        const timePart = hasTime ? deadline.split('T')[1] : undefined;

        return this.isPastDate(datePart, timePart, startHour);
    }
}
