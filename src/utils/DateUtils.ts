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
}
