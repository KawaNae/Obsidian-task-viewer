import { App, setIcon, type Menu, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { ViewState } from '../../types';
import { findOldestOverdueDate } from '../../services/display/OverdueTaskFinder';
import { TaskReadService } from '../../services/data/TaskReadService';
import { DateUtils } from '../../utils/DateUtils';
import type { LeafPosition } from '../sharedLogic/ViewUriBuilder';
import TaskViewerPlugin from '../../main';
import { DateNavigator, ViewModeSelector, ZoomSelector, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase, type ViewSettingsOptions } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import type { FilterState } from '../../services/filter/FilterTypes';
import { createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
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
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;
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
    private sidebarToggleBtn: HTMLElement | null = null;
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
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
            showAllDay: this.viewState.showAllDay,
            showTimeline: this.viewState.showTimeline,
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
        this.viewState.showAllDay = next.showAllDay;
        this.viewState.showTimeline = next.showTimeline;
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
        const { year, month } = this.getStartDateYearMonth();
        this.dateLabelHandle?.update(year, month);
        this.viewModeHandle?.update();
        this.zoomHandle?.update();
        this.maskHandle?.update();
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

    private getStartDateYearMonth(): { year: number; month: number } {
        const d = this.viewState.startDate;
        return { year: parseInt(d.substring(0, 4), 10), month: parseInt(d.substring(5, 7), 10) - 1 };
    }

    protected override buildDom(toolbar: HTMLElement): void {
        // Date Label (YYYY - MM)
        const dateLabelDeps = {
            app: this.app,
            getSettings: () => this.plugin.settings,
            linkInteractionManager: this.callbacks.linkInteractionManager,
            hoverParent: this.callbacks.hoverParent,
        };
        this.dateLabelHandle = DateLabel.render(toolbar, dateLabelDeps);
        const { year, month } = this.getStartDateYearMonth();
        this.dateLabelHandle.update(year, month);
        DateLabel.bindHoverPreview(toolbar, dateLabelDeps);

        // Date Navigation
        this.renderDateNavigation(toolbar);

        // Push action zone to the right
        toolbar.createDiv('view-toolbar__spacer');

        // Action zone (collapsed in compact mode)
        const actionZone = toolbar.createDiv('view-toolbar__action-zone');
        this.renderViewModeSwitch(actionZone);
        this.renderZoomControls(actionZone);
        this.renderFilterButton(actionZone);

        this.maskHandle = MaskToggleButton.render(actionZone, {
            getMaskMode: () => this.viewState.maskMode ?? false,
            setMaskMode: (next) => {
                this.viewState.maskMode = next;
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            },
        });

        ViewSettingsMenu.renderButton(actionZone, this.getSettingsOptions());

        // More button (compact mode — ⋮)
        const moreBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon view-toolbar__btn--more' });
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', t('toolbar.viewSettings'));

        moreBtn.onclick = (e) => {
            this.plugin.menuPresenter.present((menu) => {
                this.appendCompactMenuItems(menu, moreBtn);
                menu.addSeparator();
                ViewSettingsMenu.appendItems(menu, this.getSettingsOptions());
            }, { kind: 'mouseEvent', event: e });
        };

        // Sidebar toggle — always visible (outside action zone)
        this.renderSidebarToggle(toolbar);
    }

    private appendSectionToggles(menu: Menu): void {
        const effectiveAllDay = this.viewState.showAllDay ?? this.plugin.settings.showAllDay;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.toggleAllDay'))
                .setChecked(effectiveAllDay)
                .onClick(() => {
                    this.viewState.showAllDay = !effectiveAllDay;
                    this.callbacks.onRender();
                    this.app.workspace.requestSaveLayout();
                });
        });

        const effectiveTimeline = this.viewState.showTimeline ?? this.plugin.settings.showTimeline;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.toggleTimeline'))
                .setChecked(effectiveTimeline)
                .onClick(() => {
                    this.viewState.showTimeline = !effectiveTimeline;
                    this.callbacks.onRender();
                    this.app.workspace.requestSaveLayout();
                });
        });
    }

    private appendFollowGlobal(menu: Menu): void {
        const hasAstroOverride = this.viewState.astronomyDisplay != null
            && Object.keys(this.viewState.astronomyDisplay).length > 0;
        const hasAllDayOverride = this.viewState.showAllDay !== undefined;
        const hasTimelineOverride = this.viewState.showTimeline !== undefined;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.followGlobal'))
                .setIcon('rotate-ccw')
                .setDisabled(!hasAstroOverride && !hasAllDayOverride && !hasTimelineOverride)
                .onClick(() => {
                    this.viewState.astronomyDisplay = undefined;
                    this.viewState.showAllDay = undefined;
                    this.viewState.showTimeline = undefined;
                    this.callbacks.onRender();
                    this.app.workspace.requestSaveLayout();
                });
        });
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
            {}
        );
    }

    /**
     * Finds the oldest date with incomplete overdue tasks.
     * Returns null if all past tasks are completed.
     */
    private findOldestOverdueDate(): string | null {
        const startHour = this.plugin.settings.startHour;
        const readService = this.plugin.getTaskReadService();
        const filterState = this.getFilterState();
        const displayTasks = readService.getFilteredTasks(filterState);

        return findOldestOverdueDate(displayTasks, startHour, this.plugin.settings.statusDefinitions, readService);
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

        filterBtn.onclick = (e) => {
            const allTasks = this.readService.getTasks();

            this.filterMenu.showMenu(e, {
                onFilterChange: () => {
                    this.persistFilterState();
                    this.callbacks.onRender();
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

    private getSettingsOptions(): ViewSettingsOptions {
        return {
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
                const cfg = this.codec.parseConfig(template.config ?? null);
                this.applyConfigToViewState(cfg);
                if (template.name) this.callbacks.onRename(template.name);
                this.callbacks.onRender();
                this.app.workspace.requestSaveLayout();
            },
            getExportContainer: () => this.rootEl?.closest<HTMLElement>('.timeline-view') ?? null,
            getExportSpec: () => ({
                scrollAreas: ['.timeline-grid'],
                overflowParents: '.timeline-view',
            }),
            onReset: () => {
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
                    omitFollowGlobal: true,
                    onChange: (next) => {
                        this.viewState.astronomyDisplay = next;
                        this.callbacks.onRender();
                        this.app.workspace.requestSaveLayout();
                    },
                });
                this.appendSectionToggles(menu);
                this.appendFollowGlobal(menu);
            },
        };
    }

    private appendCompactMenuItems(menu: Menu, moreBtn: HTMLElement): void {
        // View mode (submenu)
        const currentDays = this.viewState.daysToShow;
        const viewModeLabel = currentDays === 1 ? t('toolbar.viewMode1Day')
            : currentDays === 3 ? t('toolbar.viewMode3Days')
            : t('toolbar.viewModeWeek');
        menu.addItem((item) => {
            item.setTitle(t('toolbar.viewModeLabel', { label: viewModeLabel }));
            const sub = item.setSubmenu();
            for (const opt of [
                { value: 1, title: t('toolbar.viewMode1Day') },
                { value: 3, title: t('toolbar.viewMode3Days') },
                { value: 7, title: t('toolbar.viewModeWeek') },
            ]) {
                sub.addItem((si) => {
                    si.setTitle(opt.title)
                        .setChecked(currentDays === opt.value)
                        .onClick(() => {
                            this.viewState.daysToShow = opt.value;
                            this.callbacks.onRender();
                            this.app.workspace.requestSaveLayout();
                            this.update();
                        });
                });
            }
        });

        // Zoom (submenu)
        const currentZoom = this.viewState.zoomLevel ?? this.plugin.settings.zoomLevel;
        menu.addItem((item) => {
            item.setTitle(t('toolbar.zoomLabel', { pct: `${Math.round(currentZoom * 100)}%` }));
            const sub = item.setSubmenu();
            for (const level of [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]) {
                sub.addItem((si) => {
                    si.setTitle(`${Math.round(level * 100)}%`)
                        .setChecked(currentZoom === level)
                        .onClick(() => {
                            this.viewState.zoomLevel = level;
                            this.callbacks.onRender();
                            this.app.workspace.requestSaveLayout();
                            this.update();
                        });
                });
            }
        });

        menu.addSeparator();

        // Filter
        menu.addItem((item) => {
            item.setTitle(t('toolbar.filter'))
                .setIcon('filter')
                .onClick(() => {
                    const allTasks = this.readService.getTasks();
                    this.filterMenu.showMenuAtElement(moreBtn, {
                        onFilterChange: () => {
                            this.persistFilterState();
                            this.callbacks.onRender();
                            this.update();
                        },
                        getTasks: () => allTasks,
                        getStartHour: () => this.plugin.settings.startHour,
                    });
                });
        });

        // Mask
        const maskOn = this.viewState.maskMode ?? false;
        menu.addItem((item) => {
            item.setTitle(t('toolbar.maskMode'))
                .setIcon(maskOn ? 'eye-off' : 'eye')
                .setChecked(maskOn)
                .onClick(() => {
                    this.viewState.maskMode = !maskOn;
                    this.callbacks.onRender();
                    this.app.workspace.requestSaveLayout();
                    this.update();
                });
        });
    }

    private navigateDate(days: number): void {
        this.viewState.startDate = DateUtils.addDays(this.viewState.startDate, days);
        this.callbacks.onRender();
    }
}
