import { App, setIcon, type Menu, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { ViewState } from '../../types';
import { findOldestOverdueDate } from '../../services/display/OverdueTaskFinder';
import { TaskReadService } from '../../services/data/TaskReadService';
import { DateUtils } from '../../utils/DateUtils';
import type { LeafPosition } from '../sharedLogic/ViewUriBuilder';
import TaskViewerPlugin from '../../main';
import { DateNavigator, ViewModeSelector, ZoomSelector, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase } from '../sharedUI/ViewToolbar';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import type { FilterState } from '../../services/filter/FilterTypes';
import { createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { TimelineSchema, type TimelineConfig, type TimelineTransient } from './TimelineSchema';

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
 * Why mount/update instead of render-from-scratch:
 *   The owning view calls performRender() on every data change, which used to
 *   construct a fresh TimelineToolbar (and a fresh FilterMenuComponent). That
 *   meant the filter popover could not stay open across renders. By preserving
 *   the toolbar instance and its child components, the popover survives.
 */
export class TimelineToolbar extends ViewToolbarBase {
    private readonly filterMenu = new FilterMenuComponent();
    private filterBtn: HTMLElement | null = null;
    private sidebarToggleBtn: HTMLElement | null = null;
    private viewModeHandle: { update: () => void } | null = null;
    private zoomHandle: { update: () => void } | null = null;
    private maskHandle: { update: () => void } | null = null;

    constructor(
        private app: App,
        private viewState: ViewState,
        private plugin: TaskViewerPlugin,
        private readService: TaskReadService,
        private callbacks: ToolbarCallbacks
    ) {
        super();
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

    private get codec(): ViewConfigCodec<TimelineConfig, TimelineTransient> {
        return codecFor(TimelineSchema.viewType) as ViewConfigCodec<TimelineConfig, TimelineTransient>;
    }

    /** Snapshot the view's current persistable configuration. */
    private snapshotConfig(): Partial<TimelineConfig> {
        return {
            customName: this.callbacks.getCustomName(),
            filterState: this.filterMenu.getFilterState(),
            maskMode: this.viewState.maskMode,
            astronomyDisplay: this.viewState.astronomyDisplay,
            showSidebar: this.viewState.showSidebar,
            pinnedLists: this.viewState.pinnedLists,
            daysToShow: this.viewState.daysToShow as TimelineConfig['daysToShow'],
            zoomLevel: this.viewState.zoomLevel,
        };
    }

    /**
     * Apply a parsed config to the live viewState. REPLACE semantics over
     * schema defaults: fields omitted from `cfg` revert to defaults, matching
     * the symmetry rule we enforce in TimelineView.setState.
     */
    private applyConfigToViewState(cfg: Partial<TimelineConfig>): void {
        const next: Partial<TimelineConfig> = { ...TimelineSchema.defaults, ...cfg };
        if (next.filterState !== undefined) {
            this.filterMenu.setFilterState(next.filterState);
            this.viewState.filterState = next.filterState;
        } else {
            this.filterMenu.setFilterState(createEmptyFilterState());
            this.viewState.filterState = undefined;
        }
        this.viewState.maskMode = next.maskMode ?? false;
        this.viewState.astronomyDisplay = next.astronomyDisplay
            ? { ...next.astronomyDisplay }
            : undefined;
        if (next.showSidebar !== undefined) this.viewState.showSidebar = next.showSidebar;
        this.viewState.pinnedLists = next.pinnedLists;
        if (next.daysToShow !== undefined) this.viewState.daysToShow = next.daysToShow;
        if (next.zoomLevel !== undefined) this.viewState.zoomLevel = next.zoomLevel;
        // undefined here means "follow global" — REPLACE semantics intentionally
        // clears any prior per-view override.
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
     * Refreshes dynamic UI bits driven by viewState. Does NOT rebuild DOM.
     *
     * Re-hydrates the filter state from viewState only when the filter
     * popover is closed — reflecting external mutations from setState /
     * template-apply / reset paths without clobbering an in-progress edit.
     */
    override update(): void {
        if (!this.rootEl) return;
        this.maybeRehydrateFilterState();
        // View-mode and zoom labels are built once in buildDom; refresh them
        // here so external state changes (layout restore, URI params, template
        // apply) reflect in the persistent toolbar DOM.
        this.viewModeHandle?.update();
        this.zoomHandle?.update();
        this.maskHandle?.update();
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
        // DOM bindings the open popover holds. Ask the component directly
        // (popout-aware, scoped to this view's instance — global DOM lookups
        // would mis-fire across views/windows).
        if (this.filterMenu.isOpen()) return;
        if (this.viewState.filterState) {
            this.filterMenu.setFilterState(FilterSerializer.fromJSON(this.viewState.filterState));
        } else {
            this.filterMenu.setFilterState(createEmptyFilterState());
        }
    }

    protected override buildDom(toolbar: HTMLElement): void {
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

        // Mask Mode Toggle
        this.maskHandle = MaskToggleButton.render(toolbar, {
            getMaskMode: () => this.viewState.maskMode ?? false,
            setMaskMode: (next) => {
                this.viewState.maskMode = next;
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            },
        });

        // View Settings
        ViewSettingsMenu.renderButton(toolbar, {
            app: this.app,
            leaf: this.callbacks.getLeaf(),
            getCustomName: () => this.callbacks.getCustomName(),
            getDefaultName: () => VIEW_META_TIMELINE.displayText,
            onRename: (newName) => this.callbacks.onRename(newName),
            buildUri: () => ({
                configParams: this.codec.toUriParams(this.snapshotConfig()),
            }),
            viewType: VIEW_META_TIMELINE.type,
            getViewTemplateFolder: () => this.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: this.callbacks.getCustomName() || VIEW_META_TIMELINE.displayText,
                viewType: TimelineSchema.shortName,
                config: this.codec.serializeConfig(this.snapshotConfig()),
            }),
            onApplyTemplate: (template) => {
                // Migrated path: read canonical `config` dict (handles legacyKeys
                // for old field names automatically).
                const cfg = this.codec.parseConfig(template.config ?? null);
                this.applyConfigToViewState(cfg);
                if (template.name) this.callbacks.onRename(template.name);
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            },
            // Export container is the .timeline-view wrapper, not the
            // .timeline-grid scroll area itself, so the scroll-area selector
            // resolves as a proper descendant (matches the contract used by
            // the other three views and removes the self-vs-descendant trap).
            getExportContainer: () => this.rootEl?.closest<HTMLElement>('.timeline-view') ?? null,
            getExportSpec: () => ({
                scrollAreas: ['.timeline-grid'],
                overflowParents: '.timeline-view',
            }),
            onReset: () => {
                // Reset to schema defaults — symmetric with applyConfigToViewState({}).
                this.applyConfigToViewState({});
                this.viewState.pinnedListCollapsed = undefined;
                this.callbacks.onRename(undefined);
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            },
            menuPresenter: this.plugin.menuPresenter,
            appendCustomItems: (menu) => {
                appendAstronomyMenuSection(menu, {
                    overlays: ['sunTimes', 'moonPhase'],
                    settings: this.plugin.settings.astronomy,
                    instance: this.viewState.astronomyDisplay,
                    onChange: (next) => {
                        this.viewState.astronomyDisplay = next;
                        this.callbacks.onRender();
                        this.app.workspace.requestSaveLayout();
                    },
                });
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
            },
            this.plugin.menuPresenter
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
            },
            this.plugin.menuPresenter
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
