/**
 * Shared time formatter helpers.
 */
export class TimeFormatter {
    static formatSeconds(seconds: number): string {
        const safe = Math.max(0, Math.floor(seconds));
        const mins = Math.floor(safe / 60);
        const secs = safe % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    static formatSignedSeconds(seconds: number): string {
        const sign = seconds < 0 ? '-' : '';
        return `${sign}${this.formatSeconds(Math.abs(seconds))}`;
    }
}

