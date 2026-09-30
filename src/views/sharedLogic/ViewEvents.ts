import type { View } from 'obsidian';
import { notifyDayRolled, redrawView } from '../../utils/ObsidianView';

/**
 * Tells the open task viewer views what happened, keeping the two events apart:
 * settings changed (redraw in place) and the visual day changed (each view
 * follows the day its own way). They used to share one `refresh()`, and
 * Timeline and Schedule went back to today on every settings save.
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
