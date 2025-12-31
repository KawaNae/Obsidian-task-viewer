import { Menu, App } from 'obsidian';
import { ViewState } from '../../types';
import { TaskIndex } from '../../services/TaskIndex';
import { DateUtils } from '../../utils/DateUtils';
import TaskViewerPlugin from '../../main';

export interface ToolbarCallbacks {
    onRender: () => void;
    onStateChange: () => void;
    getFileColor: (filePath: string) => string | null;
    getDatesToShow: () => string[];
}

export interface FileFilterState {
    visibleFiles: Set<string> | null;
}

/**
 * Manages the toolbar UI for TimelineView.
 * Handles date navigation, view mode switching, zoom controls, and file filtering.
 */
export class TimelineToolbar {
    private filterState: FileFilterState = { visibleFiles: null };

    constructor(
        private container: HTMLElement,
        private app: App,
        private viewState: ViewState,
        private plugin: TaskViewerPlugin,
        private taskIndex: TaskIndex,
        private callbacks: ToolbarCallbacks
    ) { }

    /**
     * Gets the current visible files filter state.
     */
    getVisibleFiles(): Set<string> | null {
        return this.filterState.visibleFiles;
    }

    /**
     * Renders the toolbar into the container.
     */
    render(): void {
        const toolbar = this.container.createDiv('task-viewer-toolbar');

        // Date Navigation
        this.renderDateNavigation(toolbar);

        // View Mode Switch
        this.renderViewModeSwitch(toolbar);

        // Zoom Controls
        this.renderZoomControls(toolbar);

        // Filter Button
        this.renderFilterButton(toolbar);
    }

    private renderDateNavigation(toolbar: HTMLElement): void {
        const prevBtn = toolbar.createEl('button', { text: '<' });
        prevBtn.onclick = () => this.navigateDate(-1);

        const nextBtn = toolbar.createEl('button', { text: '>' });
        nextBtn.onclick = () => this.navigateDate(1);

        const todayBtn = toolbar.createEl('button', { text: 'Today' });
        todayBtn.onclick = () => {
            this.viewState.startDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
            this.callbacks.onRender();
        };
    }

    private renderViewModeSwitch(toolbar: HTMLElement): void {
        const modeSelect = toolbar.createEl('select');
        modeSelect.createEl('option', { value: '1', text: '1 Day' });
        modeSelect.createEl('option', { value: '3', text: '3 Days' });
        modeSelect.createEl('option', { value: '7', text: 'Week' });
        modeSelect.value = this.viewState.daysToShow.toString();
        modeSelect.onchange = (e) => {
            const newValue = parseInt((e.target as HTMLSelectElement).value);
            this.viewState.daysToShow = newValue;
            this.callbacks.onRender();
            this.app.workspace.requestSaveLayout();
        };
    }

    private renderZoomControls(toolbar: HTMLElement): void {
        const zoomContainer = toolbar.createDiv('zoom-controls');

        const zoomOutBtn = zoomContainer.createEl('button', { text: '-' });
        zoomOutBtn.onclick = async () => {
            let newZoom = this.plugin.settings.zoomLevel - 0.25;
            if (newZoom < 0.25) newZoom = 0.25;
            this.plugin.settings.zoomLevel = newZoom;
            await this.plugin.saveSettings();
            this.callbacks.onRender();
        };

        zoomContainer.createSpan({
            cls: 'zoom-label',
            text: `${Math.round(this.plugin.settings.zoomLevel * 100)}%`
        });

        const zoomInBtn = zoomContainer.createEl('button', { text: '+' });
        zoomInBtn.onclick = async () => {
            let newZoom = this.plugin.settings.zoomLevel + 0.25;
            if (newZoom > 4.0) newZoom = 4.0;
            this.plugin.settings.zoomLevel = newZoom;
            await this.plugin.saveSettings();
            this.callbacks.onRender();
        };
    }

    private renderFilterButton(toolbar: HTMLElement): void {
        const filterBtn = toolbar.createEl('button', { text: 'Filter' });
        filterBtn.onclick = (e) => {
            const menu = new Menu();

            const dates = this.callbacks.getDatesToShow();
            const allTasksInView = dates.flatMap(date =>
                this.taskIndex.getTasksForVisualDay(date, this.plugin.settings.startHour)
            );
            const distinctFiles = Array.from(new Set(allTasksInView.map(t => t.file))).sort();

            distinctFiles.forEach(file => {
                const isVisible = this.filterState.visibleFiles === null ||
                    this.filterState.visibleFiles.has(file);
                const color = this.callbacks.getFileColor(file);
                const fileName = file.split('/').pop() || file;

                menu.addItem(item => {
                    item.setTitle(fileName)
                        .setChecked(isVisible)
                        .onClick(() => {
                            if (this.filterState.visibleFiles === null) {
                                this.filterState.visibleFiles = new Set(distinctFiles);
                            }

                            if (isVisible) {
                                this.filterState.visibleFiles.delete(file);
                            } else {
                                this.filterState.visibleFiles.add(file);
                            }

                            if (this.filterState.visibleFiles.size === distinctFiles.length) {
                                this.filterState.visibleFiles = null;
                            }

                            this.callbacks.onRender();
                        });

                    item.setIcon('circle');
                    const iconEl = (item as any).dom.querySelector('.menu-item-icon');

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
        };
    }

    private navigateDate(days: number): void {
        const date = new Date(this.viewState.startDate);
        date.setDate(date.getDate() + days);
        this.viewState.startDate = DateUtils.getLocalDateString(date);
        this.callbacks.onRender();
    }
}
