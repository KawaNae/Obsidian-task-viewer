import { App } from 'obsidian';
import { ColorUtils } from '../utils/ColorUtils';

/**
 * Shared utility functions for views.
 * Contains common color-related logic used across TimelineView, ScheduleView, and KanbanView.
 */
export class ViewUtils {
    /**
     * Gets the custom color for a file from its frontmatter.
     * @param app - Obsidian App instance
     * @param filePath - Path to the file
     * @param frontmatterKey - The frontmatter key to look for (e.g., 'color')
     * @returns The color value or null if not found
     */
    static getFileColor(app: App, filePath: string, frontmatterKey: string | null): string | null {
        if (!frontmatterKey) return null;

        const cache = app.metadataCache.getCache(filePath);
        return cache?.frontmatter?.[frontmatterKey] || null;
    }

    /**
     * Applies a file-based accent color to a task element.
     * Sets CSS custom properties for the accent color (HSL format for flexibility).
     * @param el - The HTML element to style
     * @param color - The color value (hex or named color)
     */
    static applyTaskColor(el: HTMLElement, color: string | null): void {
        if (!color) return;

        const hsl = ColorUtils.hexToHSL(color);
        if (hsl) {
            const { h, s, l } = hsl;
            el.style.setProperty('--accent-h', h.toString());
            el.style.setProperty('--accent-s', s + '%');
            el.style.setProperty('--accent-l', l + '%');

            el.style.setProperty('--color-accent-hsl', `var(--accent-h), var(--accent-s), var(--accent-l)`);
            el.style.setProperty('--file-accent', `hsl(var(--accent-h), var(--accent-s), var(--accent-l))`);
            el.style.setProperty('--file-accent-hover', `hsl(calc(var(--accent-h) - 1), calc(var(--accent-s) * 1.01), calc(var(--accent-l) * 1.075))`);
        } else {
            // Fallback for named colors or invalid hex
            el.style.setProperty('--file-accent', color);
            el.style.setProperty('--file-accent-hover', color);
        }
    }

    /**
     * Convenience method that combines getFileColor and applyTaskColor.
     * @param app - Obsidian App instance
     * @param el - The HTML element to style
     * @param filePath - Path to the file
     * @param frontmatterKey - The frontmatter key to look for
     */
    static applyFileColor(app: App, el: HTMLElement, filePath: string, frontmatterKey: string | null): void {
        const color = ViewUtils.getFileColor(app, filePath, frontmatterKey);
        ViewUtils.applyTaskColor(el, color);
    }
}
