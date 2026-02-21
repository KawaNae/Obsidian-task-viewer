import { setIcon } from 'obsidian';

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
     * Sets the visible files filter state (e.g. for restoring persisted state).
     */
    setVisibleFiles(files: Set<string> | null): void {
        this.visibleFiles = files;
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

                        // Read current state dynamically (not stale closure value)
                        if (this.visibleFiles.has(file)) {
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
        onToday: () => void,
        options?: { vertical?: boolean }
    ): void {
        const vertical = options?.vertical ?? false;
        const prevIcon = vertical ? 'chevron-up' : 'chevron-left';
        const nextIcon = vertical ? 'chevron-down' : 'chevron-right';
        const prevLabel = vertical ? 'Previous week' : 'Previous day';
        const nextLabel = vertical ? 'Next week' : 'Next day';

        const prevBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(prevBtn, prevIcon);
        prevBtn.setAttribute('aria-label', prevLabel);
        prevBtn.setAttribute('title', prevLabel);
        prevBtn.onclick = () => onNavigate(-1);

        const todayBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--today',
            text: 'Today'
        });
        todayBtn.setAttribute('aria-label', 'Today');
        todayBtn.setAttribute('title', 'Today');
        todayBtn.onclick = () => onToday();

        const nextBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(nextBtn, nextIcon);
        nextBtn.setAttribute('aria-label', nextLabel);
        nextBtn.setAttribute('title', nextLabel);
        nextBtn.onclick = () => onNavigate(1);
    }
}

/**
 * View mode selector (1 Day / 3 Days / Week).
 */
export class ViewModeSelector {
    static render(
        toolbar: HTMLElement,
        currentValue: number,
        onChange: (newValue: number) => void
    ): void {
        const getLabel = (val: number) => {
            if (val === 1) return '1 Day';
            if (val === 3) return '3 Days';
            return 'Week';
        };

        const button = toolbar.createEl('button', { cls: 'timeline-toolbar__btn--range timeline-toolbar__btn--view-mode' });
        const iconEl = button.createSpan('timeline-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'timeline-toolbar__btn-label' });
        setIcon(iconEl, 'chevrons-up-down');

        const applyModeLabel = (value: number) => {
            const label = getLabel(value);
            labelEl.setText(label);
            button.setAttribute('aria-label', `View mode: ${label}`);
            button.setAttribute('title', `View mode: ${label}`);
        };
        applyModeLabel(currentValue);

        button.onclick = (e) => {
            const { Menu } = require('obsidian');
            const menu = new Menu();

            menu.addItem((item: any) => {
                item.setTitle('1 Day')
                    .setChecked(currentValue === 1)
                    .onClick(() => {
                        onChange(1);
                        applyModeLabel(1);
                    });
            });

            menu.addItem((item: any) => {
                item.setTitle('3 Days')
                    .setChecked(currentValue === 3)
                    .onClick(() => {
                        onChange(3);
                        applyModeLabel(3);
                    });
            });

            menu.addItem((item: any) => {
                item.setTitle('Week')
                    .setChecked(currentValue === 7)
                    .onClick(() => {
                        onChange(7);
                        applyModeLabel(7);
                    });
            });

            menu.showAtPosition({ x: e.pageX, y: e.pageY });
        };
    }
}

/**
 * Zoom selector for timeline scaling.
 */
export class ZoomSelector {
    /**
     * Renders zoom selector button with dropdown options.
     * @param toolbar - Parent element to render into
     * @param currentZoom - Current zoom level (e.g., 1.0 = 100%)
     * @param onZoomChange - Callback when zoom changes
     */
    static render(
        toolbar: HTMLElement,
        currentZoom: number,
        onZoomChange: (newZoom: number) => Promise<void>
    ): void {
        const button = toolbar.createEl('button', { cls: 'timeline-toolbar__btn--range timeline-toolbar__btn--zoom' });
        const iconEl = button.createSpan('timeline-toolbar__btn-icon');
        const labelEl = button.createSpan({ cls: 'timeline-toolbar__btn-label' });
        setIcon(iconEl, 'search');

        const applyLabel = (zoom: number) => {
            const pct = `${Math.round(zoom * 100)}%`;
            labelEl.setText(pct);
            button.setAttribute('aria-label', `Zoom: ${pct}`);
            button.setAttribute('title', `Zoom: ${pct}`);
        };
        applyLabel(currentZoom);

        const zoomLevels = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
        button.onclick = (e) => {
            const { Menu } = require('obsidian');
            const menu = new Menu();
            for (const level of zoomLevels) {
                const pct = `${Math.round(level * 100)}%`;
                menu.addItem((item: any) => {
                    item.setTitle(pct)
                        .setChecked(currentZoom === level)
                        .onClick(async () => {
                            await onZoomChange(level);
                            applyLabel(level);
                        });
                });
            }
            menu.showAtPosition({ x: e.pageX, y: e.pageY });
        };
    }
}
