import { Task } from '../types';

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
        if (now.getHours() < startHour) {
            visualDateOfNow.setDate(visualDateOfNow.getDate() - 1);
        }
        return this.getLocalDateString(visualDateOfNow);
    }

    static timeToMinutes(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    static isSameDay(date1: Date, date2: Date): boolean {
        return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
    }

    /**
     * Calculate task date range based on task type.
     * Returns { start: string, end: string } where both are YYYY-MM-DD format.
     * 
     * According to spec:
     * - SED/SE: startDate to endDate
     * - SD/S-All/S-Timed: start = startDate, end = startDate (1-day width or use endDate)
     * - E/ED: start = today, end = endDate
     * - D: start = today, end = today (1-day width)
     */
    static getTaskDateRange(task: Task): { start: string, end: string } {
        const today = this.getLocalDateString(new Date());

        const hasStart = !!task.startDate && !task.isFuture;
        const hasEnd = !!task.endDate;
        const hasDeadline = !!task.deadline;

        let start: string;
        let end: string;

        if (hasStart && hasEnd) {
            // SED, SE type - explicit start and end
            start = task.startDate!;
            end = task.endDate!;
        } else if (hasStart && !hasEnd) {
            // SD, S-All, S-Timed type
            start = task.startDate!;
            end = task.startDate!; // 1-day width
        } else if (!hasStart && hasEnd) {
            // E, ED type
            start = today;
            end = task.endDate!;
        } else if (!hasStart && hasDeadline) {
            // D type - only deadline
            start = today;
            end = today; // 1-day width
        } else {
            // Future or no dates
            start = today;
            end = today;
        }

        return { start, end };
    }
}
