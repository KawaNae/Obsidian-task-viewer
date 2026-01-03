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

/**
 * Reusable file filter menu component.
 * Provides a dropdown menu to toggle visibility of tasks by their source file.
 */
export class FileFilterMenu {
    private visibleFiles: Set<string> | null = null;

    /**
     * Gets the currently visible files. Returns null if all files are visible.
     */
    getVisibleFiles(): Set<string> | null {
        return this.visibleFiles;
    }

    /**
     * Checks if a file is currently visible based on filter state.
     */
    isFileVisible(filePath: string): boolean {
        return this.visibleFiles === null || this.visibleFiles.has(filePath);
    }

    /**
     * Shows the filter menu at the given position.
     * @param e - Mouse event for positioning
     * @param files - Array of distinct file paths to show in menu
     * @param getFileColor - Callback to get color for a file
     * @param onFilterChange - Callback when filter state changes
     */
    showMenu(
        e: MouseEvent,
        files: string[],
        getFileColor: (filePath: string) => string | null,
        onFilterChange: () => void
    ): void {
        // Import Menu dynamically to avoid circular dependency
        const { Menu } = require('obsidian');
        const menu = new Menu();

        files.forEach(file => {
            const isVisible = this.visibleFiles === null || this.visibleFiles.has(file);
            const color = getFileColor(file);
            const fileName = file.split('/').pop() || file;

            menu.addItem((item: any) => {
                item.setTitle(fileName)
                    .setChecked(isVisible)
                    .onClick(() => {
                        if (this.visibleFiles === null) {
                            this.visibleFiles = new Set(files);
                        }

                        if (isVisible) {
                            this.visibleFiles.delete(file);
                        } else {
                            this.visibleFiles.add(file);
                        }

                        if (this.visibleFiles.size === files.length) {
                            this.visibleFiles = null;
                        }

                        onFilterChange();
                    });

                item.setIcon('circle');
                const iconEl = item.dom?.querySelector('.menu-item-icon');

                if (iconEl) {
                    if (color) {
                        iconEl.style.color = color;
                        iconEl.style.fill = color;
                    } else {
                        iconEl.style.visibility = 'hidden';
                    }
                }
            });
        });

        menu.showAtPosition({ x: e.pageX, y: e.pageY });
    }
}

/**
 * Date navigation component with prev/next/today buttons.
 */
export class DateNavigator {
    /**
     * Renders date navigation buttons.
     * @param toolbar - Parent element to render into
     * @param onNavigate - Callback when navigating by days (e.g., -1 or +1)
     * @param onToday - Callback when clicking Today button
     */
    static render(
        toolbar: HTMLElement,
        onNavigate: (days: number) => void,
        onToday: () => void
    ): void {
        const prevBtn = toolbar.createEl('button', { text: '<' });
        prevBtn.onclick = () => onNavigate(-1);

        const nextBtn = toolbar.createEl('button', { text: '>' });
        nextBtn.onclick = () => onNavigate(1);

        const todayBtn = toolbar.createEl('button', { text: 'Today' });
        todayBtn.onclick = () => onToday();
    }
}

/**
 * View mode selector (1 Day / 3 Days / Week).
 */
export class ViewModeSelector {
    /**
     * Renders a view mode dropdown.
     * @param toolbar - Parent element to render into
     * @param currentValue - Current selected value (1, 3, or 7)
     * @param onChange - Callback when selection changes
     */
    static render(
        toolbar: HTMLElement,
        currentValue: number,
        onChange: (newValue: number) => void
    ): void {
        const modeSelect = toolbar.createEl('select');
        modeSelect.createEl('option', { value: '1', text: '1 Day' });
        modeSelect.createEl('option', { value: '3', text: '3 Days' });
        modeSelect.createEl('option', { value: '7', text: 'Week' });
        modeSelect.value = currentValue.toString();
        modeSelect.onchange = (e) => {
            const newValue = parseInt((e.target as HTMLSelectElement).value);
            onChange(newValue);
        };
    }
}

/**
 * Zoom controls for timeline scaling.
 */
export class ZoomControls {
    /**
     * Renders zoom in/out buttons with percentage display.
     * @param toolbar - Parent element to render into
     * @param currentZoom - Current zoom level (e.g., 1.0 = 100%)
     * @param onZoomChange - Callback when zoom changes
     */
    static render(
        toolbar: HTMLElement,
        currentZoom: number,
        onZoomChange: (newZoom: number) => Promise<void>
    ): void {
        const zoomContainer = toolbar.createDiv('view-toolbar__zoom-controls');

        const zoomOutBtn = zoomContainer.createEl('button', { text: '-' });
        zoomOutBtn.onclick = async () => {
            let newZoom = currentZoom - 0.25;
            if (newZoom < 0.25) newZoom = 0.25;
            await onZoomChange(newZoom);
        };

        zoomContainer.createSpan({
            cls: 'view-toolbar__zoom-label',
            text: `${Math.round(currentZoom * 100)}%`
        });

        const zoomInBtn = zoomContainer.createEl('button', { text: '+' });
        zoomInBtn.onclick = async () => {
            let newZoom = currentZoom + 0.25;
            if (newZoom > 4.0) newZoom = 4.0;
            await onZoomChange(newZoom);
        };
    }
}
