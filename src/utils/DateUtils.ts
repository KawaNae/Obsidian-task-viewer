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
}
