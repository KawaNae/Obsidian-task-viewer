/**
 * Shared time formatter helpers.
 */
export class TimeFormatter {
    /**
     * A duration as the timers show it: `MM:SS`, and `H:MM:SS` from an hour
     * on. The widget's ring and header, the timer view and the notices of a
     * record all show it so.
     */
    static formatSeconds(seconds: number): string {
        const safe = Math.max(0, Math.floor(seconds));
        const hours = Math.floor(safe / 3600);
        const mins = Math.floor((safe % 3600) / 60);
        const secs = safe % 60;
        const mmss = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        return hours > 0 ? `${hours}:${mmss}` : mmss;
    }

    static formatSignedSeconds(seconds: number): string {
        const sign = seconds < 0 ? '-' : '';
        return `${sign}${this.formatSeconds(Math.abs(seconds))}`;
    }
}
