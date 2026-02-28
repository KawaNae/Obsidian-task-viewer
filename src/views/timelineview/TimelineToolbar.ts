import { App, setIcon, type WorkspaceLeaf } from 'obsidian';
import { ViewState, isCompleteStatusChar } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { DateUtils } from '../../utils/DateUtils';
import type { LeafPosition } from '../../utils/ViewUriBuilder';
import TaskViewerPlugin from '../../main';
import { DateNavigator, ViewModeSelector, ZoomSelector, ViewSettingsMenu } from '../ViewToolbar';
import { FilterMenuComponent } from '../menus/FilterMenuComponent';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import type { FilterState } from '../../services/filter/FilterTypes';
import { createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import type { Task } from '../../types';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';

export interface ToolbarCallbacks {
    onRender: () => void;
    onStateChange: () => void;
    getDatesToShow: () => string[];
    onRequestSidebarToggle: (nextOpen: boolean, source: 'toolbar' | 'backdrop' | 'escape') => void;
    getLeafPosition: () => LeafPosition;
    getCustomName: () => string | undefined;
    onRename: (newName: string | undefined) => void;
    getLeaf: () => WorkspaceLeaf;
}

/**
 * Manages the toolbar UI for TimelineView.
 * Handles date navigation, view mode switching, zoom controls, and filtering.
 */
export class TimelineToolbar {
    private filterMenu = new FilterMenuComponent();
    private sidebarToggleBtn: HTMLElement | null = null;

    constructor(
        private container: HTMLElement,
        private app: App,
        private viewState: ViewState,
        private plugin: TaskViewerPlugin,
        private taskIndex: TaskIndex,
        private callbacks: ToolbarCallbacks
    ) { }

    /**
     * Returns a predicate that checks if a task passes the current filter.
     */
    getTaskFilter(): (task: Task) => boolean {
        return (task: Task) => this.filterMenu.isTaskVisible(task);
    }

    /**
     * Returns whether any filters are currently active.
     */
    hasActiveFilters(): boolean {
        return this.filterMenu.hasActiveFilters();
    }

    /**
     * Closes the filter popover if open.
     */
    closeFilterPopover(): void {
        this.filterMenu.close();
    }

    /**
     * Synchronizes the sidebar toggle button state with current viewState.
     */
    syncSidebarToggleState(): void {
        if (this.sidebarToggleBtn) {
            this.updateSidebarToggleBtn(this.sidebarToggleBtn);
        }
    }

    /**
     * Renders the toolbar into the container.
     */
    render(): void {
        // Restore persisted filter state
        if (this.viewState.filterState) {
            this.filterMenu.setFilterState(FilterSerializer.fromJSON(this.viewState.filterState));
        } else if (this.viewState.filterFiles && this.viewState.filterFiles.length > 0) {
            // Migrate legacy filterFiles to FilterState
            this.filterMenu.setFilterState({
                root: {
                    type: 'group',
                    id: 'migrated-file-group',
                    children: [{
                        type: 'condition',
                        id: 'migrated-file',
                        property: 'file',
                        operator: 'includes',
                        value: { type: 'stringSet', values: this.viewState.filterFiles },
                    }],
                    logic: 'and',
                },
            });
        } else {
            this.filterMenu.setFilterState(createEmptyFilterState());
        }

        const toolbar = this.container.createDiv('view-toolbar');

        // Date Navigation
        this.renderDateNavigation(toolbar);

        // View Mode Switch
        this.renderViewModeSwitch(toolbar);

        // Zoom Controls
        this.renderZoomControls(toolbar);

        // Push filter/toggle controls to the right
        toolbar.createDiv('view-toolbar__spacer');

        // Filter Button
        this.renderFilterButton(toolbar);

        // View Settings
        ViewSettingsMenu.renderButton(toolbar, {
            app: this.app,
            leaf: this.callbacks.getLeaf(),
            getCustomName: () => this.callbacks.getCustomName(),
            getDefaultName: () => VIEW_META_TIMELINE.displayText,
            onRename: (newName) => this.callbacks.onRename(newName),
            buildUri: () => ({
                filterState: this.filterMenu.getFilterState(),
                days: this.viewState.daysToShow,
                zoom: this.viewState.zoomLevel,
                pinnedLists: this.viewState.pinnedLists,
                showSidebar: this.viewState.showSidebar,
            }),
            viewType: VIEW_META_TIMELINE.type,
            getViewTemplateFolder: () => this.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: this.callbacks.getCustomName() || VIEW_META_TIMELINE.displayText,
                viewType: 'timeline',
                days: this.viewState.daysToShow,
                zoom: this.viewState.zoomLevel,
                showSidebar: this.viewState.showSidebar,
                filterState: this.filterMenu.getFilterState(),
                pinnedLists: this.viewState.pinnedLists,
            }),
            onApplyTemplate: (template) => {
                if (template.days != null) this.viewState.daysToShow = template.days;
                if (template.zoom != null) this.viewState.zoomLevel = template.zoom;
                if (template.showSidebar != null) this.viewState.showSidebar = template.showSidebar;
                if (template.filterState) {
                    this.filterMenu.setFilterState(template.filterState);
                    this.viewState.filterState = template.filterState;
                }
                if (template.pinnedLists) this.viewState.pinnedLists = template.pinnedLists;
                if (template.name) this.callbacks.onRename(template.name);
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            },
        });

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
        const currentZoom = this.viewState.zoomLevel ?? this.plugin.settings.zoomLevel;
        ZoomSelector.render(
            toolbar,
            currentZoom,
            async (newZoom) => {
                this.viewState.zoomLevel = newZoom;
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            }
        );
    }

    private renderFilterButton(toolbar: HTMLElement): void {
        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', 'Filter');
        filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());

        filterBtn.onclick = (e) => {
            const allTasks = this.taskIndex.getTasks();

            this.filterMenu.showMenu(e, {
                onFilterChange: () => {
                    this.persistFilterState();
                    this.callbacks.onRender();
                    filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());
                },
                getTasks: () => allTasks,
            });
        };
    }

    private persistFilterState(): void {
        const state = this.filterMenu.getFilterState();
        this.viewState.filterState = hasConditions(state)
            ? FilterSerializer.fromJSON(FilterSerializer.toJSON(state))
            : undefined;
        this.viewState.filterFiles = null; // Clear legacy field
        this.app.workspace.requestSaveLayout();
    }

    private renderSidebarToggle(toolbar: HTMLElement): void {
        const toggleBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--icon timeline-toolbar__btn--sidebar-toggle sidebar-toggle-button-icon'
        });
        this.sidebarToggleBtn = toggleBtn;
        this.updateSidebarToggleBtn(toggleBtn);

        toggleBtn.onclick = () => {
            const nextOpen = !this.viewState.showSidebar;
            this.callbacks.onRequestSidebarToggle(nextOpen, 'toolbar');
        };
    }

    private updateSidebarToggleBtn(toggleBtn: HTMLElement): void {
        updateSidebarToggleButton(toggleBtn, this.viewState.showSidebar);
    }

    private navigateDate(days: number): void {
        const date = new Date(this.viewState.startDate);
        date.setDate(date.getDate() + days);
        this.viewState.startDate = DateUtils.getLocalDateString(date);
        this.callbacks.onRender();
    }
}
