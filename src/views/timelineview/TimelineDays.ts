/**
 * The days Timeline draws, derived from the day it looks at.
 *
 * The view holds the day it looks at as the transient `date`: absent, it
 * follows today; present, it stays on that day. The window it draws is not
 * held: it is read from the day, the settings and the tasks each time
 * (`timelineWindow`), so a change of "past days to show" shows at once.
 *
 * "Start from the oldest overdue task" (S2) pulls the window's start back to
 * the oldest overdue day — only while the view follows today, and read only
 * at the moments it enters following (`settle`): when it opens with its
 * tasks, on Now, when the day rolls and when the settings are saved. Between
 * them the pull is kept as it was, so completing the oldest overdue task does
 * not move the window under the cursor. The pull is not saved. Pulled far
 * enough, today can fall out of the window; the setting says so.
 */

import { DateUtils } from '../../utils/DateUtils';
import { followToday, viewedDay } from '../base/ViewedDay';

/** A run of days: the first, and how many. */
export interface DayWindow {
    readonly start: string;
    readonly days: number;
}

/**
 * The window that shows `viewedDay` with `pastDaysToShow` days before it,
 * pulled back to `overduePull` when that is earlier.
 */
export function timelineWindow(
    viewedDay: string,
    pastDaysToShow: number,
    daysToShow: number,
    overduePull: string | null,
): DayWindow {
    const lead = DateUtils.addDays(viewedDay, -pastDaysToShow);
    const start = overduePull !== null && overduePull < lead ? overduePull : lead;
    return { start, days: daysToShow };
}

/** The days of `window`, in order. */
export function windowDates(window: DayWindow): string[] {
    const dates: string[] = [];
    for (let i = 0; i < window.days; i++) dates.push(DateUtils.addDays(window.start, i));
    return dates;
}

/** The last day of `window`. */
export function windowEnd(window: DayWindow): string {
    return DateUtils.addDays(window.start, window.days - 1);
}

export interface TimelineDaysDeps {
    /** Today: the visual day. */
    today(): string;
    pastDaysToShow(): number;
    /** Whether the view starts from the oldest overdue task (the setting). */
    pullsToOverdue(): boolean;
    /** The oldest day with an overdue task the view shows, or null. */
    oldestOverdue(): string | null;
}

/**
 * The rules of the day Timeline looks at. `date` is the view's transient
 * field (undefined: following today); what a command returns is the patch of
 * it. The one thing kept here is the overdue pull.
 */
export class TimelineDays {
    private pull: string | null = null;

    constructor(private readonly deps: TimelineDaysDeps) {}

    /** The day the view looks at: its fixed day, or today. */
    viewedDay(date: string | undefined): string {
        return viewedDay(date, this.deps.today());
    }

    /** The window drawn for `date`. A fixed day is not pulled. */
    window(date: string | undefined, daysToShow: number): DayWindow {
        return timelineWindow(
            this.viewedDay(date),
            this.deps.pastDaysToShow(),
            daysToShow,
            date === undefined ? this.pull : null,
        );
    }

    /**
     * A moment of entering following (open with tasks, Now, the day rolled,
     * the settings saved, the date cleared): read the oldest overdue again
     * and keep it. On a fixed day there is nothing to keep.
     */
    settle(date: string | undefined): void {
        this.pull = date === undefined && this.deps.pullsToOverdue() ? this.deps.oldestOverdue() : null;
    }

    /** Now: follow today again, pulled anew. */
    now(): { date: undefined } {
        this.settle(undefined);
        return followToday();
    }

    /**
     * Move the window drawn by `n` days: the day looked at is then the new
     * start plus the past days, so a pulled window moves without a jump.
     */
    moved(date: string | undefined, daysToShow: number, n: number): { date: string } {
        const start = this.window(date, daysToShow).start;
        return { date: DateUtils.addDays(start, n + this.deps.pastDaysToShow()) };
    }

    /** Go to day `d`: look at it, the past days before it as for today. */
    goTo(d: string): { date: string } {
        return { date: d };
    }

    /**
     * The visual day changed. A view following today moves with it, pulled
     * anew, and scrolls to now; a fixed one stays.
     *
     * @returns whether to scroll to now
     */
    dayRolled(date: string | undefined): boolean {
        if (date !== undefined) return false;
        this.settle(undefined);
        return true;
    }
}
