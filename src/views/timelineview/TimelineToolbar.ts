import { setIcon, type Menu } from 'obsidian';
import { t } from '../../i18n';
import { DateNavigator, DaysToShowSelector, ZoomSelector, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase, appendCompactFilterAndMask, editViewFilter } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import type { ViewToolbarHost } from '../base/TaskViewerView';
import type { DayWindow } from './TimelineDays';
import { daysToShowOf, effectiveZoom, MIN_DAYS_TO_SHOW, MAX_DAYS_TO_SHOW, type TimelineState } from './TimelineSchema';

/** What Timeline does that is not a change of its state, or reads from more than it. */
export interface TimelineCommands {
    /** Move the drawn window by `n` days. */
    navigateDays(n: number): void;
    /** Follow today again and scroll to now. */
    jumpToNow(): void;
    /** Look at `date`. */
    jumpToDate(date: string): void;
    /** The day the view looks at; the date picker opens on it. */
    viewedDay(): string;
    /** The days drawn. */
    window(): DayWindow;
    /** Whether the sidebar shows (closed at narrow width until opened). */
    isSidebarOpen(): boolean;
    /** Open or close the sidebar, sliding. */
    toggleSidebar(open: boolean): void;
}

export interface TimelineToolbarDeps {
    host: ViewToolbarHost<TimelineState>;
    commands: TimelineCommands;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;
}

/**
 * Manages the toolbar UI for TimelineView.
 *
 * It reads and writes the view's store, and mends its controls whenever the
 * store changes, so it holds no copy of the view's state.
 *
 * Why mount/update instead of render-from-scratch:
 *   The owning view draws on every data change. By preserving the toolbar
 *   instance and its child components, the filter popover survives draws.
 */
export class TimelineToolbar extends ViewToolbarBase {
    private sidebarToggleBtn: HTMLElement | null = null;
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
    private viewModeHandle: { update: () => void } | null = null;
    private zoomHandle: { update: () => void } | null = null;
    private maskHandle: { update: () => void } | null = null;
    private readonly filterMenu: FilterMenuComponent;

    constructor(private deps: TimelineToolbarDeps) {
        super();
        this.filterMenu = new FilterMenuComponent(deps.host.app.keymap);
        this.filterMenu.setStatusDefinitions(deps.host.plugin.settings.statusDefinitions);
        deps.host.store.subscribe(() => this.update());
    }

    private get store() {
        return this.deps.host.store;
    }

    private get settings() {
        return this.deps.host.plugin.settings;
    }

    /** Close the popovers the toolbar opened. */
    close(): void {
        this.filterMenu.close();
    }

    /** Synchronizes the sidebar toggle button with the view's sidebar state. */
    syncSidebarToggleState(): void {
        if (this.sidebarToggleBtn) {
            updateSidebarToggleButton(this.sidebarToggleBtn, this.deps.commands.isSidebarOpen());
        }
    }

    /** Refreshes dynamic UI bits. Does NOT rebuild DOM. */
    override update(): void {
        if (!this.rootEl) return;
        const { year, month } = this.referenceMonth();
        this.dateLabelHandle?.update(year, month);
        this.viewModeHandle?.update();
        this.zoomHandle?.update();
        this.maskHandle?.update();
        this.syncSidebarToggleState();
    }

    /** Year / month of the first day drawn. */
    private referenceMonth(): { year: number; month: number } {
        const d = this.deps.commands.window().start;
        return { year: parseInt(d.substring(0, 4), 10), month: parseInt(d.substring(5, 7), 10) - 1 };
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;
        const { host, commands } = deps;

        // Date Label (YYYY - MM)
        const dateLabelDeps = {
            app: host.app,
            getSettings: () => host.plugin.settings,
            notes: host.plugin.getOperations(),
            linkInteractionManager: deps.linkInteractionManager,
            hoverParent: deps.hoverParent,
        };
        this.dateLabelHandle = DateLabel.render(toolbar, dateLabelDeps);
        const ref = this.referenceMonth();
        this.dateLabelHandle.update(ref.year, ref.month);
        DateLabel.bindHoverPreview(toolbar, dateLabelDeps);

        // Date Navigation
        DateNavigator.render(
            toolbar,
            (days) => commands.navigateDays(days),
            () => commands.jumpToNow(),
            {
                dateJump: {
                    getCurrentDate: () => commands.viewedDay(),
                    onJump: (date) => commands.jumpToDate(date),
                },
            }
        );

        // Push action zone to the right
        toolbar.createDiv('view-toolbar__spacer');

        // Action zone (collapsed in compact mode)
        const actionZone = toolbar.createDiv('view-toolbar__action-zone');
        this.renderViewModeSwitch(actionZone);
        this.renderZoomControls(actionZone);
        this.renderFilterButton(actionZone);

        this.maskHandle = MaskToggleButton.render(actionZone, {
            getMaskMode: () => this.store.get().maskMode ?? false,
            setMaskMode: (next) => this.store.update({ maskMode: next }),
        });

        ViewSettingsMenu.renderButton(actionZone, this.settingsOptions());

        // More button (compact mode — ⋮)
        const moreBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon view-toolbar__btn--more' });
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', t('toolbar.viewSettings'));

        moreBtn.onclick = (e) => {
            host.plugin.menuPresenter.present((menu) => {
                this.appendCompactMenuItems(menu, moreBtn);
                menu.addSeparator();
                ViewSettingsMenu.appendItems(menu, this.settingsOptions());
            }, { kind: 'mouseEvent', event: e });
        };

        // Sidebar toggle — always visible (outside action zone)
        this.renderSidebarToggle(toolbar);
    }

    private appendSectionToggles(menu: Menu): void {
        const state = this.store.get();
        const effectiveAllDay = state.showAllDay ?? this.settings.showAllDay;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.toggleAllDay'))
                .setChecked(effectiveAllDay)
                .onClick(() => this.store.update({ showAllDay: !effectiveAllDay }));
        });

        const effectiveTimeline = state.showTimeline ?? this.settings.showTimeline;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.toggleTimeline'))
                .setChecked(effectiveTimeline)
                .onClick(() => this.store.update({ showTimeline: !effectiveTimeline }));
        });
    }

    private appendFollowGlobal(menu: Menu): void {
        const state = this.store.get();
        const astro = state.astronomyDisplay;
        const hasAstroOverride = astro != null && Object.keys(astro).length > 0;
        const hasAllDayOverride = state.showAllDay !== undefined;
        const hasTimelineOverride = state.showTimeline !== undefined;
        menu.addItem((item) => {
            item.setTitle(t('viewOptions.followGlobal'))
                .setIcon('rotate-ccw')
                .setDisabled(!hasAstroOverride && !hasAllDayOverride && !hasTimelineOverride)
                .onClick(() => this.store.update({
                    astronomyDisplay: undefined,
                    showAllDay: undefined,
                    showTimeline: undefined,
                }));
        });
    }

    private daysToShow(): number {
        return daysToShowOf(this.store.get());
    }

    private zoom(): number {
        return effectiveZoom(this.store.get(), this.settings);
    }

    private renderViewModeSwitch(toolbar: HTMLElement): void {
        this.viewModeHandle = DaysToShowSelector.render(
            toolbar,
            () => this.daysToShow(),
            (newValue) => this.store.update({ daysToShow: newValue }),
            this.deps.host.plugin.menuPresenter,
            { min: MIN_DAYS_TO_SHOW, max: MAX_DAYS_TO_SHOW }
        );
    }

    private renderZoomControls(toolbar: HTMLElement): void {
        this.zoomHandle = ZoomSelector.render(
            toolbar,
            () => this.zoom(),
            (newZoom) => this.store.update({ zoomLevel: newZoom }),
            this.deps.host.plugin.menuPresenter
        );
    }

    private renderFilterButton(toolbar: HTMLElement): void {
        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', t('toolbar.filter'));

        filterBtn.onclick = (e) => {
            const allTasks = this.deps.host.plugin.getIndex().getTasks();
            editViewFilter(this.filterMenu, { event: e }, this.store, () => allTasks);
        };
    }

    private renderSidebarToggle(toolbar: HTMLElement): void {
        const { commands } = this.deps;
        const toggleBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--icon sidebar-toggle-button-icon'
        });
        this.sidebarToggleBtn = toggleBtn;
        updateSidebarToggleButton(toggleBtn, commands.isSidebarOpen());

        toggleBtn.onclick = () => {
            commands.toggleSidebar(!commands.isSidebarOpen());
        };
    }

    private settingsOptions() {
        return this.deps.host.settingsOptions((menu) => {
            appendAstronomyMenuSection(menu, {
                overlays: ['sunTimes', 'moonPhase'],
                settings: this.settings.astronomy,
                instance: this.store.get().astronomyDisplay,
                omitFollowGlobal: true,
                onChange: (next) => this.store.update({ astronomyDisplay: next }),
            });
            this.appendSectionToggles(menu);
            this.appendFollowGlobal(menu);
        });
    }

    private appendCompactMenuItems(menu: Menu, moreBtn: HTMLElement): void {
        DaysToShowSelector.appendSubmenu(
            menu,
            () => this.daysToShow(),
            (value) => this.store.update({ daysToShow: value }),
            { min: MIN_DAYS_TO_SHOW, max: MAX_DAYS_TO_SHOW },
        );
        ZoomSelector.appendSubmenu(
            menu,
            () => this.zoom(),
            (level) => this.store.update({ zoomLevel: level }),
        );

        menu.addSeparator();

        appendCompactFilterAndMask(menu, moreBtn, {
            filterMenu: this.filterMenu,
            store: this.store,
            getTasks: () => this.deps.host.plugin.getIndex().getTasks(),
        });
    }
}
