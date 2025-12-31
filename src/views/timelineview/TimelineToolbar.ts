import { Menu, App } from 'obsidian';
import { ViewState } from '../../types';
import { TaskIndex } from '../../services/TaskIndex';
import { DateUtils } from '../../utils/DateUtils';
import TaskViewerPlugin from '../../main';
import { FileFilterMenu } from '../ViewUtils';

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
