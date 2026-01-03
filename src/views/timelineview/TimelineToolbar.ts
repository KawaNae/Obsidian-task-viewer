import { App } from 'obsidian';
import { ViewState } from '../../types';
import { TaskIndex } from '../../services/TaskIndex';
import { DateUtils } from '../../utils/DateUtils';
import TaskViewerPlugin from '../../main';
import { FileFilterMenu, DateNavigator, ViewModeSelector, ZoomControls } from '../ViewUtils';

export interface ToolbarCallbacks {
    onRender: () => void;
    onStateChange: () => void;
    getFileColor: (filePath: string) => string | null;
    getDatesToShow: () => string[];
}

/**
 * Manages the toolbar UI for TimelineView.
 * Handles date navigation, view mode switching, zoom controls, and file filtering.
 */
export class TimelineToolbar {
    private filterMenu = new FileFilterMenu();

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
        return this.filterMenu.getVisibleFiles();
    }

    /**
     * Renders the toolbar into the container.
     */
    render(): void {
        const toolbar = this.container.createDiv('view-toolbar');

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
        DateNavigator.render(
            toolbar,
            (days) => this.navigateDate(days),
            () => {
                this.viewState.startDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
                this.callbacks.onRender();
            }
        );
    }

    private renderViewModeSwitch(toolbar: HTMLElement): void {
        ViewModeSelector.render(
            toolbar,
            this.viewState.daysToShow,
            (newValue) => {
                this.viewState.daysToShow = newValue;
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            }
        );
    }

    private renderZoomControls(toolbar: HTMLElement): void {
        ZoomControls.render(
            toolbar,
            this.plugin.settings.zoomLevel,
            async (newZoom) => {
                this.plugin.settings.zoomLevel = newZoom;
                await this.plugin.saveSettings();
                this.callbacks.onRender();
            }
        );
    }

    private renderFilterButton(toolbar: HTMLElement): void {
        const filterBtn = toolbar.createEl('button', { text: 'Filter' });
        filterBtn.onclick = (e) => {
            const dates = this.callbacks.getDatesToShow();
            const allTasksInView = dates.flatMap(date =>
                this.taskIndex.getTasksForVisualDay(date, this.plugin.settings.startHour)
            );
            const distinctFiles = Array.from(new Set(allTasksInView.map(t => t.file))).sort();

            this.filterMenu.showMenu(
                e,
                distinctFiles,
                (file) => this.callbacks.getFileColor(file),
                () => this.callbacks.onRender()
            );
        };
    }

    private navigateDate(days: number): void {
        const date = new Date(this.viewState.startDate);
        date.setDate(date.getDate() + days);
        this.viewState.startDate = DateUtils.getLocalDateString(date);
        this.callbacks.onRender();
    }
}
