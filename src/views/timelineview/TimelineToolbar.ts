import { App, setIcon, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { ViewState, isCompleteStatusChar } from '../../types';
import { TaskReadService } from '../../services/data/TaskReadService';
import { DateUtils } from '../../utils/DateUtils';
import type { LeafPosition } from '../sharedLogic/ViewUriBuilder';
import TaskViewerPlugin from '../../main';
import { DateNavigator, ViewModeSelector, ZoomSelector, ViewSettingsMenu } from '../sharedUI/ViewToolbar';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import { TimelineExportStrategy } from '../../services/export/TimelineExportStrategy';
import type { FilterState } from '../../services/filter/FilterTypes';
import { createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';

export interface ToolbarCallbacks {
    onRender: () => void;
    onScrollToNow: () => void;
    onStateChange: () => void;
    getDatesToShow: () => string[];
    onRequestSidebarToggle: (nextOpen: boolean) => void;
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
        private readService: TaskReadService,
        private callbacks: ToolbarCallbacks
    ) {
        this.filterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.filterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.filterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);
    }

    /**
     * Returns the current FilterState object (for readService queries).
     */
    getFilterState(): FilterState {
        return this.filterMenu.getFilterState();
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
            getExportContainer: () => this.container.closest('.timeline-view')?.querySelector<HTMLElement>('.timeline-grid') ?? null,
            getReadService: () => this.readService,
            getExportStrategy: () => new TimelineExportStrategy(),
            onReset: () => {
                this.viewState.daysToShow = 3;
                this.viewState.zoomLevel = 1.0;
                this.viewState.showSidebar = true;
                this.viewState.filterState = undefined;
                this.viewState.pinnedLists = undefined;
                this.viewState.pinnedListCollapsed = undefined;
                this.filterMenu.setFilterState(createEmptyFilterState());
                this.callbacks.onRename(undefined);
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
                const visualToday = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
                const visualPastDate = DateUtils.addDays(visualToday, -this.plugin.settings.pastDaysToShow);
                if (this.plugin.settings.startFromOldestOverdue) {
                    const oldestOverdueDate = this.findOldestOverdueDate();
                    this.viewState.startDate = (oldestOverdueDate && oldestOverdueDate < visualPastDate) ? oldestOverdueDate : visualPastDate;
                } else {
                    this.viewState.startDate = visualPastDate;
                }
                this.callbacks.onScrollToNow();
            },
            { label: t('toolbar.now') }
        );
    }

    /**
     * Finds the oldest date with incomplete overdue tasks.
     * Returns null if all past tasks are completed.
     */
    private findOldestOverdueDate(): string | null {
        const startHour = this.plugin.settings.startHour;
        const visualToday = DateUtils.getVisualDateOfNow(startHour);
        const readService = this.plugin.getTaskReadService();
        const filterState = this.getFilterState();
        const displayTasks = readService.getFilteredTasks(filterState);

        // Find the oldest past date among incomplete tasks
        let oldestDate: string | null = null;

        for (const dt of displayTasks) {
            if (!dt.effectiveStartDate) continue;
            if (isCompleteStatusChar(dt.statusChar, this.plugin.settings.statusDefinitions)) continue;

            if (dt.effectiveStartDate < visualToday) {
                if (!oldestDate || dt.effectiveStartDate < oldestDate) {
                    oldestDate = dt.effectiveStartDate;
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
        filterBtn.setAttribute('aria-label', t('toolbar.filter'));
        filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());

        filterBtn.onclick = (e) => {
            const allTasks = this.readService.getTasks();

            this.filterMenu.showMenu(e, {
                onFilterChange: () => {
                    this.persistFilterState();
                    this.callbacks.onRender();
                    filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());
                },
                getTasks: () => allTasks,
                getStartHour: () => this.plugin.settings.startHour,
            });
        };
    }

    private persistFilterState(): void {
        const state = this.filterMenu.getFilterState();
        this.viewState.filterState = hasConditions(state)
            ? FilterSerializer.fromJSON(FilterSerializer.toJSON(state))
            : undefined;
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
            this.callbacks.onRequestSidebarToggle(nextOpen);
        };
    }

    private updateSidebarToggleBtn(toggleBtn: HTMLElement): void {
        updateSidebarToggleButton(toggleBtn, this.viewState.showSidebar);
    }

    private navigateDate(days: number): void {
        this.viewState.startDate = DateUtils.addDays(this.viewState.startDate, days);
        this.callbacks.onRender();
    }
}
