import type { View } from 'obsidian';
import { notifyDayRolled, notifyMinute, redrawView } from '../../utils/ObsidianView';

/**
 * Tells the open task viewer views what happened, keeping the events apart:
 * settings changed (redraw in place), the visual day changed (each view
 * follows the day its own way) and a minute passed (`MinuteClock`'s tick).
 * Settings and the day used to share one `refresh()`, and Timeline and
 * Schedule went back to today on every settings save.
 *
 * This is the one place that decides the visual day changed. `watch` starts
 * from the current day; before it, there is no day to have rolled from.
 */
export class ViewEvents {
    private lastVisualDate: string | null = null;

    constructor(
        private readonly views: () => View[],
        private readonly visualToday: () => string,
    ) { }

    watch(): void {
        this.lastVisualDate = this.visualToday();
    }

    /** Settings were saved. A new start hour can move the day; then the views follow it. */
    settingsChanged(): void {
        if (this.rollIfChanged()) return;
        this.views().forEach(redrawView);
    }

    /**
     * A minute passed. The day is checked on the minute, so a view follows
     * the new day within a minute of it; then the views hear the minute.
     */
    minutePassed(): void {
        this.rollIfChanged();
        this.views().forEach(notifyMinute);
    }

    /** @returns whether the day rolled (and the views were told) */
    rollIfChanged(): boolean {
        if (this.lastVisualDate === null) return false;
        const today = this.visualToday();
        if (today === this.lastVisualDate) return false;
        this.lastVisualDate = today;
        this.views().forEach(notifyDayRolled);
        return true;
    }
}
