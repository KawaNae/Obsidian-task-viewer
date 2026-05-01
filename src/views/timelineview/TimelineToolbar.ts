import { App, setIcon, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { ViewState } from '../../types';
import { findOldestOverdueDate } from '../../services/display/OverdueTaskFinder';
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
 *
 * Lifecycle:
 *   - constructor — dependency injection only, no DOM work
 *   - mount(host) — build DOM under a persistent rootEl on first call;
 *                   re-attach existing rootEl to a new host on subsequent calls
 *   - detach()   — remove rootEl from its host but keep DOM + child components alive
 *   - update()   — refresh dynamic UI (filter button active class, sidebar toggle)
 *
 * Why mount/update instead of render-from-scratch:
 *   The owning view calls performRender() on every data change, which used to
 *   construct a fresh TimelineToolbar (and a fresh FilterMenuComponent). That
 *   meant the filter popover could not stay open across renders. By preserving
 *   the toolbar instance and its child components, the popover survives.
 */
export class TimelineToolbar {
    private readonly filterMenu = new FilterMenuComponent();
    private host: HTMLElement | null = null;
    private rootEl: HTMLElement | null = null;
    private filterBtn: HTMLElement | null = null;
    private sidebarToggleBtn: HTMLElement | null = null;
    private viewModeHandle: { update: () => void } | null = null;
    private zoomHandle: { update: () => void } | null = null;

    constructor(
        private app: App,
        private viewState: ViewState,
        private plugin: TaskViewerPlugin,
        private readService: TaskReadService,
        private callbacks: ToolbarCallbacks
    ) {
        this.filterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.filterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.filterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);

        // Hydrate filter state from persisted viewState eagerly so callers like
        // getFilterState() see the persisted filter even before the first mount().
        // After this, the filterMenu owns the in-memory state; persistence flows
        // back to viewState.filterState on every change via persistFilterState().
        if (this.viewState.filterState) {
            this.filterMenu.setFilterState(FilterSerializer.fromJSON(this.viewState.filterState));
        } else {
            this.filterMenu.setFilterState(createEmptyFilterState());
        }
    }

    /**
     * Returns the current FilterState object (for readService queries).
     * Single source of truth: the persisted viewState.filterState wins on
     * mount; thereafter the filterMenu owns the in-memory state and writes
     * back to viewState.filterState on every change.
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
     * Mounts the toolbar into `host`.
     *
     * - First call: builds the rootEl + child DOM, hydrates filter state from
     *   viewState, runs an update().
     * - Subsequent calls (typical: every performRender after container.empty()):
     *   re-attaches the existing rootEl to `host` and runs update(). DOM and
     *   child components are preserved so the filter popover survives.
     */
    mount(host: HTMLElement): void {
        if (this.rootEl) {
            // Already built: just (re-)attach to the new host and refresh
            // dynamic state. Skip filter-state hydration so an open popover's
            // in-progress edits are not clobbered.
            if (this.host !== host || this.rootEl.parentElement !== host) {
                host.appendChild(this.rootEl);
                this.host = host;
            }
            this.update();
            return;
        }

        this.host = host;
        this.rootEl = host.createDiv('view-toolbar');
        this.buildDom(this.rootEl);
        this.update();
    }

    /**
     * Detaches the rootEl from its current host, preserving DOM and child
     * components. Call this immediately before container.empty() so the
     * empty() does not destroy the toolbar DOM; then call mount() again on
     * the fresh host.
     */
    detach(): void {
        if (this.rootEl?.parentElement) {
            this.rootEl.parentElement.removeChild(this.rootEl);
        }
        this.host = null;
    }

    /**
     * Refreshes dynamic UI bits driven by viewState. Does NOT rebuild DOM.
     *
     * Re-hydrates the filter state from viewState only when the filter
     * popover is closed — reflecting external mutations from setState /
     * template-apply / reset paths without clobbering an in-progress edit.
     */
    update(): void {
        if (!this.rootEl) return;
        this.maybeRehydrateFilterState();
        // View-mode and zoom labels are built once in buildDom; refresh them
        // here so external state changes (layout restore, URI params, template
        // apply) reflect in the persistent toolbar DOM.
        this.viewModeHandle?.update();
        this.zoomHandle?.update();
        if (this.filterBtn) {
            this.filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());
        }
        if (this.sidebarToggleBtn) {
            this.updateSidebarToggleBtn(this.sidebarToggleBtn);
        }
    }

    private maybeRehydrateFilterState(): void {
        // Skip while the popover is open: setFilterState() replaces the
        // FilterMenuComponent's internal state object, which would orphan any
        // DOM bindings the open popover holds. We use the body-level popover
        // DOM presence as the open-ness signal — FilterMenuComponent appends
        // `.filter-popover` to document.body when shown and removes it on close.
        if (document.querySelector('.filter-popover')) return;
        if (this.viewState.filterState) {
            this.filterMenu.setFilterState(FilterSerializer.fromJSON(this.viewState.filterState));
        } else {
            this.filterMenu.setFilterState(createEmptyFilterState());
        }
    }

    private buildDom(toolbar: HTMLElement): void {
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
            getExportContainer: () => this.rootEl?.closest('.timeline-view')?.querySelector<HTMLElement>('.timeline-grid') ?? null,
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

        return findOldestOverdueDate(displayTasks, visualToday, this.plugin.settings.statusDefinitions);
    }

    private renderViewModeSwitch(toolbar: HTMLElement): void {
        this.viewModeHandle = ViewModeSelector.render(
            toolbar,
            () => this.viewState.daysToShow,
            (newValue) => {
                this.viewState.daysToShow = newValue;
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            }
        );
    }

    private renderZoomControls(toolbar: HTMLElement): void {
        this.zoomHandle = ZoomSelector.render(
            toolbar,
            () => this.viewState.zoomLevel ?? this.plugin.settings.zoomLevel,
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
        this.filterBtn = filterBtn;

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
