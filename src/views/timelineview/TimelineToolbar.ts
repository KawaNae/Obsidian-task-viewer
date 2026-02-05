import { App, setIcon } from 'obsidian';
import { ViewState, isCompleteStatusChar } from '../../types';
import { TaskIndex } from '../../services/TaskIndex';
import { DateUtils } from '../../utils/DateUtils';
import TaskViewerPlugin from '../../main';
import { FileFilterMenu, DateNavigator, ViewModeSelector, ZoomControls } from '../ViewUtils';

export interface ToolbarCallbacks {
    onRender: () => void;
    onStateChange: () => void;
    getFileColor: (filePath: string) => string | null;
    getDatesToShow: () => string[];
    onToggleDeadlineList?: () => void;
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
        // Restore persisted filter state
        if (this.viewState.filterFiles) {
            this.filterMenu.setVisibleFiles(new Set(this.viewState.filterFiles));
        }

        const toolbar = this.container.createDiv('view-toolbar');

        // Date Navigation
        this.renderDateNavigation(toolbar);

        // View Mode Switch
        this.renderViewModeSwitch(toolbar);

        // Zoom Controls
        this.renderZoomControls(toolbar);

        // Filter Button
        this.renderFilterButton(toolbar);

        // Sidebar Toggle
        this.renderSidebarToggle(toolbar);
    }

    private renderDateNavigation(toolbar: HTMLElement): void {
        DateNavigator.render(
            toolbar,
            (days) => this.navigateDate(days),
            () => {
                const oldestOverdueDate = this.findOldestOverdueDate();
                const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
                const pastDate = DateUtils.addDays(today, -this.plugin.settings.pastDaysToShow);
                this.viewState.startDate = (oldestOverdueDate && oldestOverdueDate < pastDate) ? oldestOverdueDate : pastDate;
                this.callbacks.onRender();
            }
        );
    }

    /**
     * Finds the oldest date with incomplete overdue tasks.
     * Returns null if all past tasks are completed.
     */
    private findOldestOverdueDate(): string | null {
        const startHour = this.plugin.settings.startHour;
        const today = DateUtils.getVisualDateOfNow(startHour);

        // Get all incomplete tasks with dates before today
        const tasks = this.taskIndex.getTasks().filter(t =>
            !isCompleteStatusChar(t.statusChar, this.plugin.settings.completeStatusChars) &&

            t.startDate
        );

        // Find the oldest past date among incomplete tasks
        let oldestDate: string | null = null;

        for (const task of tasks) {
            const taskDate = task.startDate!;

            // Only consider tasks that are before today (visual date)
            if (taskDate < today) {
                if (!oldestDate || taskDate < oldestDate) {
                    oldestDate = taskDate;
                }
            }
        }

        return oldestDate;
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
        const filterBtn = toolbar.createEl('button', { text: 'Filter', cls: 'view-toolbar__btn--text' });
        filterBtn.onclick = (e) => {
            const dates = this.callbacks.getDatesToShow();
            const allTasksInView = dates.flatMap(date =>
                this.taskIndex.getTasksForVisualDay(date, this.plugin.settings.startHour)
            );
            // Include deadline task files in the filter list
            const deadlineTasks = this.taskIndex.getDeadlineTasks();
            const allFiles = new Set([
                ...allTasksInView.map(t => t.file),
                ...deadlineTasks.map(t => t.file)
            ]);
            const distinctFiles = Array.from(allFiles).sort();

            this.filterMenu.showMenu(
                e,
                distinctFiles,
                (file) => this.callbacks.getFileColor(file),
                () => {
                    // Persist filter state
                    const visible = this.filterMenu.getVisibleFiles();
                    this.viewState.filterFiles = visible ? Array.from(visible) : null;
                    this.app.workspace.requestSaveLayout();
                    this.callbacks.onRender();
                }
            );
        };
    }

    private renderSidebarToggle(toolbar: HTMLElement): void {
        const toggleBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(toggleBtn, 'sidebar-right');
        toggleBtn.setAttribute('aria-label', 'Toggle Deadline List');

        if (this.viewState.showDeadlineList) {
            toggleBtn.addClass('is-active');
        }

        toggleBtn.onclick = () => {
            this.viewState.showDeadlineList = !this.viewState.showDeadlineList;
            if (this.viewState.showDeadlineList) {
                toggleBtn.addClass('is-active');
            } else {
                toggleBtn.removeClass('is-active');
            }
            this.callbacks.onToggleDeadlineList?.();
        };
    }

    private navigateDate(days: number): void {
        const date = new Date(this.viewState.startDate);
        date.setDate(date.getDate() + days);
        this.viewState.startDate = DateUtils.getLocalDateString(date);
        this.callbacks.onRender();
    }
}
