/**
 * Shared time formatter helpers.
 */

/** The minutes a duration is shown in alone, below which it is `MM:SS`. */
const MINUTES_SHOWN_ALONE = 1000;

export class TimeFormatter {
    /**
     * A duration as the timers show it: `MM:SS`, the minutes up to three
     * digits, and `H:MM:SS` from 1000 minutes on. Minutes alone keep a work
     * session or a night's sleep in the unit the timers' lengths are set in;
     * the hours take over only when the minutes would run to four digits.
     * The widget's ring and header, the timer view and the notices of a
     * record all show it so.
     */
    static formatSeconds(seconds: number): string {
        const safe = Math.max(0, Math.floor(seconds));
        const totalMins = Math.floor(safe / 60);
        const secs = safe % 60;
        const pad = (n: number) => n.toString().padStart(2, '0');
        if (totalMins < MINUTES_SHOWN_ALONE) return `${pad(totalMins)}:${pad(secs)}`;
        return `${Math.floor(totalMins / 60)}:${pad(totalMins % 60)}:${pad(secs)}`;
    }

    static formatSignedSeconds(seconds: number): string {
        const sign = seconds < 0 ? '-' : '';
        return `${sign}${this.formatSeconds(Math.abs(seconds))}`;
    }
}
