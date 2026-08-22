import { type App, setIcon, type Menu, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type { AstronomyDisplay } from '../../types';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type TaskViewerPlugin from '../../main';
import { DateNavigator, ViewModeSelector, ZoomSelector, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase, appendCompactFilterAndMask, type ViewSettingsOptions, type CompactMenuDeps } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import type { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { TimelineSchema, type TimelineConfig, type TimelineTransient } from './TimelineSchema';

/**
 * Everything the toolbar needs from TimelineView, as a bundle of narrow
 * closures. Mirrors the contract Calendar / Schedule / Kanban / MiniCalendar
 * already use: reading and writing config lives in the View, the toolbar only
 * calls. In particular the toolbar holds no reference to the view's mutable
 * state object and no copy of the config-apply rules.
 */
export interface TimelineToolbarDeps {
    app: App;
    plugin: TaskViewerPlugin;
    readService: TaskReadService;
    /** Owned by the view — the toolbar only opens and closes the popover. */
    filterMenu: FilterMenuComponent;
    getLeaf: () => WorkspaceLeaf;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;

    onFilterChange: () => void;
    onNavigateDays: (days: number) => void;
    /** Jump to today (or the oldest overdue date) and scroll to now. */
    onJumpToNow: () => void;

    getCustomName: () => string | undefined;
    onRename: (newName: string | undefined) => void;

    /** Snapshot the view's full persistable config for template save / URI build. */
    getCurrentConfig: () => Partial<TimelineConfig>;
    /** Apply a parsed config (template load / URI / reset). */
    applyConfig: (cfg: Partial<TimelineConfig>) => void;
    /**
     * Reset to defaults. Separate from `applyConfig({})` because Timeline also
     * drops its transient pinned-list collapse state, which is not part of the
     * config at all.
     */
    onReset: () => void;
    /** Trigger render + saveLayout side effects after applyConfig / onReset. */
    onConfigApplied: () => void;

    getReferenceMonth: () => { year: number; month: number };

    getDaysToShow: () => number;
    setDaysToShow: (days: number) => void;

    /** Effective zoom: the per-view override if set, otherwise the global setting. */
    getZoomLevel: () => number;
    setZoomLevel: (zoom: number) => void;

    getMaskMode: () => boolean;
    setMaskMode: (next: boolean) => void;

    getAstronomyDisplay: () => Partial<AstronomyDisplay> | undefined;
    setAstronomyDisplay: (next: Partial<AstronomyDisplay> | undefined) => void;

    /** undefined = follow the global setting. */
    getShowAllDay: () => boolean | undefined;
    setShowAllDay: (next: boolean | undefined) => void;
    getShowTimeline: () => boolean | undefined;
    setShowTimeline: (next: boolean | undefined) => void;
    /** Drop every per-view override (astronomy / all-day / timeline). */
    onFollowGlobal: () => void;

    getShowSidebar: () => boolean;
    onRequestSidebarToggle: (nextOpen: boolean) => void;
}

/**
 * Manages the toolbar UI for TimelineView.
 *
 * Why mount/update instead of render-from-scratch:
 *   The owning view calls performRender() on every data change, which used to
 *   construct a fresh TimelineToolbar. By preserving the toolbar instance and
 *   its child components, the filter popover survives across renders.
 */
export class TimelineToolbar extends ViewToolbarBase {
    private sidebarToggleBtn: HTMLElement | null = null;
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
    private viewModeHandle: { update: () => void } | null = null;
    private zoomHandle: { update: () => void } | null = null;
    private maskHandle: { update: () => void } | null = null;

    constructor(private deps: TimelineToolbarDeps) {
        super();
    }

    private get codec(): ViewConfigCodec<TimelineConfig, TimelineTransient> {
        return codecFor(TimelineSchema.viewType) as ViewConfigCodec<TimelineConfig, TimelineTransient>;
    }

    /** Synchronizes the sidebar toggle button with the view's sidebar state. */
    syncSidebarToggleState(): void {
        if (this.sidebarToggleBtn) {
            updateSidebarToggleButton(this.sidebarToggleBtn, this.deps.getShowSidebar());
        }
    }

    /** Refreshes dynamic UI bits. Does NOT rebuild DOM. */
    override update(): void {
        if (!this.rootEl) return;
        const { year, month } = this.deps.getReferenceMonth();
        this.dateLabelHandle?.update(year, month);
        this.viewModeHandle?.update();
        this.zoomHandle?.update();
        this.maskHandle?.update();
        this.syncSidebarToggleState();
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;

        // Date Label (YYYY - MM)
        const dateLabelDeps = {
            app: deps.app,
            getSettings: () => deps.plugin.settings,
            linkInteractionManager: deps.linkInteractionManager,
            hoverParent: deps.hoverParent,
        };
        this.dateLabelHandle = DateLabel.render(toolbar, dateLabelDeps);
        const ref = deps.getReferenceMonth();
        this.dateLabelHandle.update(ref.year, ref.month);
        DateLabel.bindHoverPreview(toolbar, dateLabelDeps);

        // Date Navigation
        DateNavigator.render(
            toolbar,
            (days) => deps.onNavigateDays(days),
            () => deps.onJumpToNow(),
            {}
        );

        // Push action zone to the right
        toolbar.createDiv('view-toolbar__spacer');

        // Action zone (collapsed in compact mode)
        const actionZone = toolbar.createDiv('view-toolbar__action-zone');
        this.renderViewModeSwitch(actionZone);
        this.renderZoomControls(actionZone);
        this.renderFilterButton(actionZone);

        this.maskHandle = MaskToggleButton.render(actionZone, {
            getMaskMode: () => deps.getMaskMode(),
            setMaskMode: (next) => deps.setMaskMode(next),
        });

        ViewSettingsMenu.renderButton(actionZone, this.getSettingsOptions());

        // More button (compact mode — ⋮)
        const moreBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon view-toolbar__btn--more' });
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', t('toolbar.viewSettings'));

        moreBtn.onclick = (e) => {
            deps.plugin.menuPresenter.present((menu) => {
                this.appendCompactMenuItems(menu, moreBtn);
                menu.addSeparator();
                ViewSettingsMenu.appendItems(menu, this.getSettingsOptions());
            }, { kind: 'mouseEvent', event: e });
        };

        // Sidebar toggle — always visible (outside action zone)
        this.renderSidebarToggle(toolbar);
    }

    private appendSectionToggles(menu: Menu): void {
        const { deps } = this;
        const effectiveAllDay = deps.getShowAllDay() ?? deps.plugin.settings.showAllDay;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.toggleAllDay'))
                .setChecked(effectiveAllDay)
                .onClick(() => deps.setShowAllDay(!effectiveAllDay));
        });

        const effectiveTimeline = deps.getShowTimeline() ?? deps.plugin.settings.showTimeline;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.toggleTimeline'))
                .setChecked(effectiveTimeline)
                .onClick(() => deps.setShowTimeline(!effectiveTimeline));
        });
    }

    private appendFollowGlobal(menu: Menu): void {
        const { deps } = this;
        const astro = deps.getAstronomyDisplay();
        const hasAstroOverride = astro != null && Object.keys(astro).length > 0;
        const hasAllDayOverride = deps.getShowAllDay() !== undefined;
        const hasTimelineOverride = deps.getShowTimeline() !== undefined;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.followGlobal'))
                .setIcon('rotate-ccw')
                .setDisabled(!hasAstroOverride && !hasAllDayOverride && !hasTimelineOverride)
                .onClick(() => deps.onFollowGlobal());
        });
    }

    private renderViewModeSwitch(toolbar: HTMLElement): void {
        this.viewModeHandle = ViewModeSelector.render(
            toolbar,
            () => this.deps.getDaysToShow(),
            (newValue) => this.deps.setDaysToShow(newValue),
            this.deps.plugin.menuPresenter
        );
    }

    private renderZoomControls(toolbar: HTMLElement): void {
        this.zoomHandle = ZoomSelector.render(
            toolbar,
            () => this.deps.getZoomLevel(),
            (newZoom) => this.deps.setZoomLevel(newZoom),
            this.deps.plugin.menuPresenter
        );
    }

    /** Shared filter + mask entries for the compact menu. */
    private get compactDeps(): CompactMenuDeps {
        const { deps } = this;
        return {
            filterMenu: deps.filterMenu,
            getTasks: () => deps.readService.getTasks(),
            getStartHour: () => deps.plugin.settings.startHour,
            onFilterChange: () => deps.onFilterChange(),
            getMaskMode: () => deps.getMaskMode(),
            setMaskMode: (next) => deps.setMaskMode(next),
            onAfter: () => this.update(),
        };
    }

    private renderFilterButton(toolbar: HTMLElement): void {
        const { deps } = this;
        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', t('toolbar.filter'));

        filterBtn.onclick = (e) => {
            const allTasks = deps.readService.getTasks();

            deps.filterMenu.showMenu(e, {
                onFilterChange: () => deps.onFilterChange(),
                getTasks: () => allTasks,
                getStartHour: () => deps.plugin.settings.startHour,
            });
        };
    }

    private renderSidebarToggle(toolbar: HTMLElement): void {
        const toggleBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--icon sidebar-toggle-button-icon'
        });
        this.sidebarToggleBtn = toggleBtn;
        updateSidebarToggleButton(toggleBtn, this.deps.getShowSidebar());

        toggleBtn.onclick = () => {
            this.deps.onRequestSidebarToggle(!this.deps.getShowSidebar());
        };
    }

    private getSettingsOptions(): ViewSettingsOptions {
        const { deps } = this;
        return {
            app: deps.app,
            leaf: deps.getLeaf(),
            getCustomName: () => deps.getCustomName(),
            getDefaultName: () => VIEW_META_TIMELINE.displayText,
            onRename: (newName) => deps.onRename(newName),
            buildUri: () => ({
                configParams: this.codec.toUriParams(deps.getCurrentConfig()),
            }),
            viewType: VIEW_META_TIMELINE.type,
            getViewTemplateFolder: () => deps.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: deps.getCustomName() || VIEW_META_TIMELINE.displayText,
                viewType: TimelineSchema.shortName,
                config: this.codec.serializeConfig(deps.getCurrentConfig()),
            }),
            onApplyTemplate: (template) => {
                const cfg = this.codec.parseConfig(template.config ?? null);
                deps.applyConfig(cfg);
                if (template.name) deps.onRename(template.name);
                deps.onConfigApplied();
            },
            getExportFolder: () => deps.plugin.settings.exportFolder,
            onReset: () => {
                deps.onReset();
                deps.onRename(undefined);
                deps.onConfigApplied();
            },
            menuPresenter: deps.plugin.menuPresenter,
            appendCustomItems: (menu) => {
                appendAstronomyMenuSection(menu, {
                    overlays: ['sunTimes', 'moonPhase'],
                    settings: deps.plugin.settings.astronomy,
                    instance: deps.getAstronomyDisplay(),
                    omitFollowGlobal: true,
                    onChange: (next) => deps.setAstronomyDisplay(next),
                });
                this.appendSectionToggles(menu);
                this.appendFollowGlobal(menu);
            },
        };
    }

    private appendCompactMenuItems(menu: Menu, moreBtn: HTMLElement): void {
        const { deps } = this;

        ViewModeSelector.appendSubmenu(
            menu,
            () => deps.getDaysToShow(),
            (value) => {
                deps.setDaysToShow(value);
                this.update();
            },
        );
        ZoomSelector.appendSubmenu(
            menu,
            () => deps.getZoomLevel(),
            (level) => {
                deps.setZoomLevel(level);
                this.update();
            },
        );

        menu.addSeparator();

        appendCompactFilterAndMask(menu, moreBtn, this.compactDeps);
    }
}
