import { ItemView, type WorkspaceLeaf, setIcon, type ViewStateResult } from 'obsidian';
import { logDebug } from '../../log/log';
import { t } from '../../i18n';
import type { MenuHandler } from '../../interaction/menu/MenuHandler';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { createCardRendering } from '../sharedUI/CardRendering';
import type { DisplayTask, PinnedListDefinition, AstronomyDisplay } from '../../types';
import { attachMoonPhase } from '../sharedUI/AstronomyCellAdorner';
import { getEffectiveAstronomyDisplay } from '../../services/astronomy/AstronomyService';
import { DateUtils } from '../../utils/DateUtils';
import { withWeekStartDay } from '../../utils/momentWeekLocale';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';
import { dailyNotes, linkTarget, periodicNotes } from '../../utils/PeriodicNotes';
import { openPeriodicNoteInLeaf } from '../sharedLogic/OpenPeriodicNote';
import { MOBILE_BREAKPOINT_PX } from '../../constants/layout';
import { getTaskDateRange } from '../../services/display/VisualDateRange';
import {
    getCalendarDateRange,
    getNormalizedWindowStart,
    getReferenceMonth,
    getColumnOffset,
    getGridColumnForDay,
} from './CalendarDateUtils';
import { DragHandler } from '../../interaction/drag/DragHandler';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { createDefaultListFilterState, createEmptyFilterState, hasConditions, type FilterState } from '../../services/filter/FilterTypes';
import { CalendarToolbar } from './CalendarToolbar';
import { createEmptySortState } from '../../services/sort/SortTypes';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { VIEW_DESCRIPTORS, viewDisplayName } from '../ViewDescriptors';
import { CalendarSchema, CalendarCodec, type CalendarConfig } from './CalendarSchema';
import { HandleManager } from '../sharedUI/handles/HandleManager';
import { markHandleSurface } from '../sharedUI/handles/HandleSurface';
import { SelectionController } from '../../interaction/selection/SelectionController';
import { parseSegmentId } from '../../services/display/SegmentIds';
import { SidebarManager } from '../sidebar/SidebarManager';
import { PinnedListRenderer } from '../sharedUI/PinnedListRenderer';
import { RenderScheduler } from '../sharedUI/RenderScheduler';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { PixelScrollRestorer } from '../sharedUI/PixelScrollRestorer';
import { computeGridLayout, type GridTaskEntry } from '../sharedLogic/GridTaskLayout';
import { renderDueArrow } from '../sharedUI/DueArrowRenderer';
import { splitTasks } from '../../services/display/TaskSplitter';
import { TopRightConfigEditor } from '../customMenus/TopRightConfigEditor';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { readViewConfig } from '../../services/viewConfig/ConfigIssueNotice';


/**
 * View id used as a namespace prefix for shared viewState fields whose keys
 * collide between views (e.g. pinnedListCollapsed). Lets timeline and calendar
 * own independent collapse state for the same listId.
 */
const VIEW_ID = 'calendar';
const COLLAPSE_KEY_PREFIX = `${VIEW_ID}::`;

interface CalendarViewState {
    windowStart?: string;
    filterState?: FilterState;
    showSidebar?: boolean;
    pinnedListCollapsed?: Record<string, boolean>;
    pinnedLists?: PinnedListDefinition[];
    customName?: string;
    maskMode?: boolean;
    astronomyDisplay?: Partial<AstronomyDisplay>;
}

export class CalendarView extends ItemView {
    private readonly plugin: PluginContext & TimerHost;
    private readonly readService: TaskReadService;
    /** The index's copies and changes (`PluginContext.getIndex`). */
    private readonly index: IndexReads;
    private readonly operations: Operations;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly viewFilterMenu = new FilterMenuComponent();
    private readonly listSortMenu = new SortMenuComponent();

    private menuHandler: MenuHandler;
    private dragHandler: DragHandler | null = null;
    private handleManager: HandleManager | null = null;
    private selectionController: SelectionController | null = null;
    private sidebarManager: SidebarManager;
    private pinnedListRenderer: PinnedListRenderer;
    /**
     * Stable host for PinnedListRenderer that survives container.empty() —
     * detached before each empty() and re-appended into sidebarBody after the
     * sidebar layout is rebuilt. This preserves PinnedList's DOM (paging
     * pages, expanded body content) and its onChange subscription across
     * full view renders.
     */
    private pinnedHost: HTMLElement;
    private listFilterMenu = new FilterMenuComponent();
    private topRightEditor = new TopRightConfigEditor();
    private toolbar: CalendarToolbar;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private unsubscribeDelete: (() => void) | null = null;
    private windowStart: string;
    private showSidebar = true;
    private pinnedListCollapsed: Record<string, boolean> = {};
    private pinnedLists: PinnedListDefinition[] = [];
    private customName: string | undefined;
    private maskMode: boolean = false;
    private astronomyDisplay: Partial<AstronomyDisplay> | undefined = undefined;
    private readonly scrollRestorer = new PixelScrollRestorer(
        () => this.container?.querySelector('.cal-grid__body') as HTMLElement | null,
    );
    private sidebarOpenedThisSession = false;
    private readonly hoverParent = new TaskViewHoverParent();
    private renderScheduler: RenderScheduler;

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext & TimerHost) {
        super(leaf);
        this.plugin = plugin;
        this.readService = plugin.getTaskReadService();
        this.index = plugin.getIndex();
        this.operations = plugin.getOperations();
        const cards = createCardRendering({
            app: this.app,
            plugin: this.plugin,
            getHoverParent: () => this.hoverParent,
            getMaskMode: () => this.maskMode,
            // The selection is let go once the gesture that opened the hub is
            // over (see TimelineView's constructor).
            afterHubOpen: () => setTimeout(() => this.handleManager?.selectTask(null), 0),
        });
        this.taskRenderer = cards.taskRenderer;
        this.menuHandler = cards.menuHandler;
        this.addChild(this.taskRenderer);
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);
        this.sidebarManager = new SidebarManager({
            mobileBreakpointPx: MOBILE_BREAKPOINT_PX,
            onPersist: () => this.app.workspace.requestSaveLayout(),
            onSyncToggleButton: () => this.toolbar?.syncSidebarToggleState(),
            onRequestClose: () => {
                this.showSidebar = false;
                this.sidebarManager.applyOpen(false, { animate: true, persist: true });
            },
            getIsOpen: () => this.showSidebar,
        });
        this.windowStart = DateUtils.getMonthGridStart(new Date(), this.plugin.settings.weekStartDay);
        this.viewFilterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);
        this.listFilterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);

        this.toolbar = new CalendarToolbar({
            app: this.app,
            leaf: this.leaf,
            plugin: this.plugin,
            readService: this.readService,
            viewFilterMenu: this.viewFilterMenu,
            container: this.containerEl,
            onNavigateWeek: (days) => this.navigateWeek(days),
            onJumpToCurrentMonth: () => this.showMonthOf(new Date()),
            onJumpToDate: (date) => {
                const parsed = DateUtils.readDate(date);
                if (parsed) this.showMonthOf(parsed);
            },
            onFilterChange: () => {
                void this.app.workspace.requestSaveLayout();
                this.render();
                this.pinnedListRenderer?.refresh();
            },
            getCustomName: () => this.customName,
            onRename: (newName) => {
                this.customName = newName;
                this.leaf.updateHeader();
                this.app.workspace.requestSaveLayout();
            },
            getPinnedLists: () => this.pinnedLists,
            setPinnedLists: (lists) => { this.pinnedLists = lists; },
            getShowSidebar: () => this.showSidebar,
            setShowSidebar: (open, opts) => {
                if (open) this.sidebarOpenedThisSession = true;
                this.showSidebar = open;
                this.sidebarManager.applyOpen(open, opts);
            },
            getCurrentConfig: () => this.getCurrentConfig(),
            applyConfig: (cfg) => this.applyConfig(cfg),
            onConfigApplied: () => {
                this.leaf.updateHeader();
                this.app.workspace.requestSaveLayout();
                this.render();
                this.pinnedListRenderer?.refresh();
            },
            getMaskMode: () => this.maskMode,
            setMaskMode: (next) => {
                this.maskMode = next;
                this.app.workspace.requestSaveLayout();
                this.render();
                this.toolbar.update();
                this.pinnedListRenderer?.refresh();
            },
            getAstronomyDisplay: () => this.astronomyDisplay,
            setAstronomyDisplay: (next) => {
                this.astronomyDisplay = next;
                this.app.workspace.requestSaveLayout();
                this.render();
                this.toolbar.update();
            },
            getReferenceMonth: () => this.getReferenceMonth(),
            getCurrentDate: () => {
                const { year, month } = this.getReferenceMonth();
                return DateUtils.getLocalDateString(new Date(year, month, 1));
            },
            linkInteractionManager: this.linkInteractionManager,
            hoverParent: this.hoverParent,
        });
    }

    getViewType(): string {
        return CalendarSchema.viewType;
    }

    getDisplayText(): string {
        return this.customName || viewDisplayName(CalendarSchema.viewType);
    }

    getIcon(): string {
        return VIEW_DESCRIPTORS[CalendarSchema.viewType].icon;
    }

    private readonly codec = CalendarCodec;

    /**
     * Apply a parsed config with REPLACE semantics over schema defaults.
     * Single entry point used by setState AND by toolbar's template apply,
     * so reset/load/restore all go through one path.
     *
     * `showSidebar` states the desktop-width starting position only. At mobile
     * width the sidebar always starts closed whatever the config says, and
     * only the toggle button opens it (see `sidebarOpenedThisSession`), so
     * applying a config never marks the sidebar as user-opened.
     */
    applyConfig(cfg: Partial<CalendarConfig>): void {
        const next = this.codec.withDefaults(cfg);

        // FilterMenu owns the in-memory FilterState — keep it in sync.
        this.viewFilterMenu.setFilterState(next.filterState ?? createEmptyFilterState());

        const sidebarOpen = next.showSidebar ?? true;
        this.showSidebar = sidebarOpen;
        this.sidebarManager.applyOpen(sidebarOpen, { animate: false });

        this.pinnedLists = next.pinnedLists ?? [];
        this.customName = next.customName;
        this.maskMode = next.maskMode === true;
        this.astronomyDisplay = next.astronomyDisplay
            ? { ...next.astronomyDisplay }
            : undefined;
    }

    /** Snapshot for template save / URI build. */
    getCurrentConfig(): Partial<CalendarConfig> {
        const filterState = this.viewFilterMenu.getFilterState();
        return {
            customName: this.customName,
            filterState: hasConditions(filterState) ? filterState : undefined,
            maskMode: this.maskMode,
            astronomyDisplay: this.astronomyDisplay,
            showSidebar: this.showSidebar,
            pinnedLists: this.pinnedLists.length > 0 ? this.pinnedLists : undefined,
        };
    }

    async setState(state: CalendarViewState, result: ViewStateResult): Promise<void> {
        const stateDict = (state ?? {}) as Record<string, unknown>;
        const config = readViewConfig(this.codec, stateDict);
        const transient = this.codec.parseTransient(stateDict);

        this.applyConfig(config);

        // Transient: windowStart needs week alignment, so it's handled here
        // rather than letting applyConfig blanket-overwrite.
        if (transient.windowStart) {
            const parsedWindowStart = DateUtils.readDate(transient.windowStart);
            if (parsedWindowStart) {
                const weekStart = DateUtils.getWeekStart(parsedWindowStart, this.plugin.settings.weekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
            }
        }
        if (transient.pinnedListCollapsed) {
            this.pinnedListCollapsed = transient.pinnedListCollapsed;
        }

        await super.setState(state, result);
        this.performRender();
        // setState may have changed filterState / pinnedLists / collapse — none
        // of these go through index.onChange, so PinnedList wouldn't
        // otherwise refresh. (Safe to call even before attach: refresh() no-ops
        // when not attached.)
        this.pinnedListRenderer?.refresh();
    }

    getState(): Record<string, unknown> {
        return {
            ...this.codec.serializeConfig(this.getCurrentConfig()),
            ...this.codec.serializeTransient({
                windowStart: this.windowStart,
                pinnedListCollapsed: this.pinnedListCollapsed,
            }),
        };
    }

    async onOpen(): Promise<void> {
        logDebug(`[${this.getViewType()}] opened`);
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('calendar-view');
        this.sidebarManager.attach(this.container, (el, ev, handler) =>
            this.registerDomEvent(el, ev, handler),
        );

        this.pinnedListRenderer = new PinnedListRenderer(
            this.taskRenderer, this.plugin, this.readService,
        );
        // Persistent host for pinned lists. Lives outside the empty() target —
        // detached before container.empty() in performRender and reparented
        // into the freshly-built sidebarBody after.
        this.pinnedHost = document.createElement('div');
        this.pinnedListRenderer.attach({
            host: this.pinnedHost,
            getLists: () => this.pinnedLists,
            getCollapsed: () => this.buildCollapsedStateForRenderer(),
            getViewFilterState: () => this.viewFilterMenu.getFilterState(),
            callbacks: this.getPinnedListCallbacks(),
        });
        this.handleManager = new HandleManager(this.container, {
            getTask: (id) => this.index.getTask(id),
            getStartHour: () => this.plugin.settings.startHour,
        });
        this.selectionController = new SelectionController(this.handleManager);
        this.dragHandler = new DragHandler(
            this.container,
            this.operations,
            this.plugin,
            this.selectionController,
            (taskId: string) => {
                // Store base task id so split segments all share one selection and
                // the selection survives a drag-move that regenerates segment ids.
                const baseId = parseSegmentId(taskId)?.baseId ?? taskId;
                this.handleManager?.selectTask(baseId);
            },
            () => this.getViewStartDateString(),
            () => this.getViewEndDateString(),
            () => this.plugin.settings.zoomLevel
        );

        this.selectionController.attachBackgroundClick(this.container);

        this.performRender();

        // Clear selection when the selected task is deleted via the UI.
        this.unsubscribeDelete = this.selectionController.attachDeleteListener(this.index);

        // Initialize render dispatch controller (rAF coalesce only). Every
        // change runs a full render(), which reconciles cards by key.
        this.renderScheduler = new RenderScheduler({
            performFull: () => this.render(),
            getHost: () => this.container,
        });

        this.unsubscribe = this.index.onChange((taskId, changes) => {
            this.renderScheduler.handleChange(taskId, changes);
        });
    }

    async onClose(): Promise<void> {
        logDebug(`[${this.getViewType()}] closed`);
        this.hoverParent.dispose();
        this.viewFilterMenu.close();
        this.listFilterMenu.close();
        this.sidebarManager.detach();
        this.pinnedListRenderer?.detach();

        this.dragHandler?.destroy();
        this.dragHandler = null;
        this.handleManager = null;

        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        if (this.unsubscribeDelete) {
            this.unsubscribeDelete();
            this.unsubscribeDelete = null;
        }
        this.renderScheduler?.dispose();
        this.scrollRestorer.dispose();
    }

    public redraw(): void {
        this.render();
    }

    private render(): void {
        this.scrollRestorer.save();
        this.performRender();
    }

    private performRender(): void {
        if (!this.container) {
            return;
        }

        const normalizedWindowStart = getNormalizedWindowStart(this.windowStart, this.plugin.settings.weekStartDay);
        if (normalizedWindowStart !== this.windowStart) {
            this.windowStart = normalizedWindowStart;
        }

        // On narrow/mobile, force sidebar closed unless user explicitly opened it this session
        if (this.sidebarManager.isNarrow() && !this.sidebarOpenedThisSession) {
            this.showSidebar = false;
        }
        this.sidebarManager.syncPresentation(this.showSidebar, { animate: false });

        this.toolbar.detach();
        // Detach the persistent pinnedHost so its DOM (and PinnedListRenderer's
        // internal subscription / paging / collapse state) survives the empty().
        // Re-appended into the freshly-built sidebarBody by renderSidebarContent.
        // IMPORTANT: must run before our `reconciler.detach(this.container)` —
        // otherwise the calendar reconciler scoops up the pinned-list cards
        // (they live inside `this.container` until detached here), classifies
        // them as stale, and disposes them while PinnedListRenderer is none the
        // wiser.
        if (this.pinnedHost?.parentElement) {
            this.pinnedHost.parentElement.removeChild(this.pinnedHost);
        }

        // Keyed reconciliation: lift surviving cards into a key→element map
        // before tearing down the month grid. Survivors are re-parented and
        // re-decorated when their key turns up in the new render;
        // unmatched ones are disposed at the end. Cards keep their inner DOM
        // (markdown, focus, expand state) intact across renders.
        const reconciler = new CardReconciler();
        reconciler.detach(this.container);

        this.container.empty();

        const toolbarHost = this.container.createDiv('calendar-view__toolbar-host');
        this.toolbar.mount(toolbarHost);
        const { main, sidebarHeader, sidebarBody } = this.sidebarManager.buildLayout(this.container);

        this.renderSidebarContent(sidebarHeader, sidebarBody);

        const calendarHost = main.createDiv('cal-grid');

        const { startDate, endDate } = this.getCalendarDateRange();
        const rangeStartStr = DateUtils.getLocalDateString(startDate);
        const rangeEndStr = DateUtils.getLocalDateString(endDate);
        this.menuHandler.setViewStartDate(rangeStartStr);

        const allVisibleTasks = this.getVisibleTasksInRange(rangeStartStr, rangeEndStr);
        const body = calendarHost.createDiv('cal-grid__body');
        this.renderWeekdayHeader(body);
        const referenceMonth = this.getReferenceMonth();
        const showWeekNumbers = this.shouldShowWeekNumbers();

        let cursor = new Date(startDate);
        while (cursor <= endDate) {
            const weekRow = body.createDiv('cal-week-row');
            if (showWeekNumbers) {
                weekRow.addClass('has-week-numbers');
            }

            const weekStartDate = new Date(cursor);
            const weekStartStr = DateUtils.getLocalDateString(cursor);
            weekRow.dataset.weekStart = weekStartStr;
            const weekDates: string[] = [];

            if (showWeekNumbers) {
                this.renderWeekNumberCell(weekRow, weekStartDate);
            }

            for (let i = 0; i < 7; i++) {
                const cellDate = new Date(cursor);
                const dateKey = DateUtils.getLocalDateString(cellDate);
                weekDates.push(dateKey);
                this.renderDateHeader(weekRow, cellDate, i + 1, referenceMonth);
                cursor.setDate(cursor.getDate() + 1);
            }

            // Add column separators (skip the outer-right edge).
            const separatorCount = showWeekNumbers ? 7 : 6;
            for (let i = 1; i <= separatorCount; i++) {
                const separator = weekRow.createDiv('cal-col-separator');
                if (showWeekNumbers) {
                    if (i === 1) {
                        separator.style.left = 'var(--calendar-wk-col-width, 32px)';
                    } else {
                        const dayBoundary = i - 1;
                        separator.style.left = `calc(var(--calendar-wk-col-width, 32px) + (${dayBoundary} / 7) * (100% - var(--calendar-wk-col-width, 32px)))`;
                    }
                } else {
                    separator.style.left = `calc(${i} / 7 * 100%)`;
                }
            }

            this.renderWeekTasks(weekRow, weekDates, allVisibleTasks, reconciler);
        }

        // Dispose any cards that did not turn up in the new render (filter
        // dropped, segments collapsed, etc). Their elements are already
        // detached from the DOM by reconciler.detach().
        reconciler.forEachStale(card => this.taskRenderer.dispose(card));

        const toolbarRootEl = this.toolbar.getRootEl();
        if (toolbarRootEl) {
            toolbarRootEl.dataset.range = `${rangeStartStr}:${rangeEndStr}`;
        }

        // The selection is shown by HandleManager alone: `.is-selected` and the
        // handles on the selected task's cards, taken off every other card. It
        // runs on every draw, a selection or none, since a kept card may carry
        // the class from the draw before.
        this.handleManager?.reapplySelectionClass();

        this.scrollRestorer.restore();
    }

    private renderSidebarContent(header: HTMLElement, body: HTMLElement): void {
        header.createEl('p', { cls: 'tv-sidebar__panel-title', text: t('pinnedList.pinnedLists') });

        const addBtn = header.createEl('button', { cls: 'tv-icon-btn tv-sidebar__panel-add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.appendText(t('pinnedList.addList'));
        addBtn.addEventListener('click', () => {
            const newId = 'pl-' + Date.now();
            this.pinnedLists.push({
                id: newId,
                name: t('pinnedList.newList'),
                filterState: createDefaultListFilterState(),
                applyViewFilter: false,
            });
            this.app.workspace.requestSaveLayout();
            this.pinnedListRenderer.scheduleRename(newId);
            this.pinnedListRenderer.refresh();
        });

        // Re-attach the persistent pinned host into the freshly-built sidebar body.
        // PinnedListRenderer manages its own contents via its onChange subscription
        // and explicit refresh() calls — we only relocate the host here.
        body.appendChild(this.pinnedHost);
    }

    private getPinnedListCallbacks() {
        return {
            onCollapsedChange: (id: string, collapsed: boolean) => {
                this.pinnedListCollapsed[`${COLLAPSE_KEY_PREFIX}${id}`] = collapsed;
                this.app.workspace.requestSaveLayout();
            },
            onSortEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => this.openPinnedListSort(listDef, anchorEl),
            onFilterEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => this.openPinnedListFilter(listDef, anchorEl),
            onDuplicate: (listDef: PinnedListDefinition) => {
                const idx = this.pinnedLists.indexOf(listDef);
                this.pinnedLists.splice(idx + 1, 0, {
                    ...listDef,
                    id: 'pl-' + Date.now(),
                    name: listDef.name + ' (copy)',
                });
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
            onRemove: (listDef: PinnedListDefinition) => {
                const idx = this.pinnedLists.indexOf(listDef);
                if (idx >= 0) this.pinnedLists.splice(idx, 1);
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
            onMoveUp: (listDef: PinnedListDefinition) => {
                const idx = this.pinnedLists.indexOf(listDef);
                if (idx > 0) {
                    [this.pinnedLists[idx - 1], this.pinnedLists[idx]] = [this.pinnedLists[idx], this.pinnedLists[idx - 1]];
                    this.app.workspace.requestSaveLayout();
                    this.pinnedListRenderer.refresh();
                }
            },
            onMoveDown: (listDef: PinnedListDefinition) => {
                const idx = this.pinnedLists.indexOf(listDef);
                if (idx >= 0 && idx < this.pinnedLists.length - 1) {
                    [this.pinnedLists[idx], this.pinnedLists[idx + 1]] = [this.pinnedLists[idx + 1], this.pinnedLists[idx]];
                    this.app.workspace.requestSaveLayout();
                    this.pinnedListRenderer.refresh();
                }
            },
            onToggleApplyViewFilter: (listDef: PinnedListDefinition) => {
                listDef.applyViewFilter = !listDef.applyViewFilter;
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
            onRename: () => {
                this.app.workspace.requestSaveLayout();
            },
            onTopRightEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => {
                const tasks = this.index.getTasks();
                const propertyKeys = FilterValueCollector.collectPropertyKeys(tasks);
                this.topRightEditor.open(anchorEl, {
                    config: listDef.topRight,
                    propertyKeys,
                    onChange: (config) => {
                        listDef.topRight = config;
                        this.app.workspace.requestSaveLayout();
                        this.pinnedListRenderer.refresh();
                    },
                });
            },
        };
    }

    /**
     * Strip the `${viewId}::` prefix so PinnedListRenderer receives a plain
     * Record<listId, boolean>. The view-side store keeps the prefix to avoid
     * timeline/calendar collapse-state collisions when both views persist into
     * the same workspace layout.
     */
    private buildCollapsedStateForRenderer(): Record<string, boolean> {
        const out: Record<string, boolean> = {};
        for (const [key, val] of Object.entries(this.pinnedListCollapsed)) {
            if (key.startsWith(COLLAPSE_KEY_PREFIX)) {
                out[key.slice(COLLAPSE_KEY_PREFIX.length)] = val;
            }
        }
        return out;
    }

    private openPinnedListSort(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.listSortMenu.setSortState(listDef.sortState ?? createEmptySortState());
        this.listSortMenu.showMenuAtElement(anchorEl, {
            onSortChange: () => {
                listDef.sortState = this.listSortMenu.getSortState();
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
        });
    }

    private openPinnedListFilter(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.listFilterMenu.setFilterState(listDef.filterState);
        this.listFilterMenu.showMenuAtElement(anchorEl, {
            onFilterChange: () => {
                listDef.filterState = this.listFilterMenu.getFilterState();
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
            getTasks: () => this.index.getTasks(),
        });
    }

    private renderWeekdayHeader(container: HTMLElement): void {
        const header = container.createDiv('cal-weekday-header');
        const showWeekNumbers = this.shouldShowWeekNumbers();
        if (showWeekNumbers) {
            header.addClass('has-week-numbers');
            header.createEl('div', { cls: 'cal-weekday-cell', text: t('calendar.wk') });
        }

        const weekdays = this.getWeekdayNames();
        weekdays.forEach((label) => {
            header.createEl('div', { cls: 'cal-weekday-cell', text: label });
        });

        // Add column separators matching week rows (align vertical grid lines exactly)
        const separatorCount = showWeekNumbers ? 7 : 6;
        for (let i = 1; i <= separatorCount; i++) {
            const separator = header.createDiv('cal-col-separator');
            if (showWeekNumbers) {
                if (i === 1) {
                    separator.style.left = 'var(--calendar-wk-col-width, 32px)';
                } else {
                    const dayBoundary = i - 1;
                    separator.style.left = `calc(var(--calendar-wk-col-width, 32px) + (${dayBoundary} / 7) * (100% - var(--calendar-wk-col-width, 32px)))`;
                }
            } else {
                separator.style.left = `calc(${i} / 7 * 100%)`;
            }
        }
    }

    private renderDateHeader(weekRow: HTMLElement, date: Date, colIndex: number, referenceMonth: { year: number; month: number }): void {
        const cell = weekRow.createDiv('cal-day-cell');
        const dateKey = DateUtils.getLocalDateString(date);
        const todayKey = DateUtils.getLocalDateString(new Date());
        const isFirstOfMonth = date.getDate() === 1;
        const dateLabel = isFirstOfMonth
            ? dateKey
            : `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        cell.style.gridColumn = `${getGridColumnForDay(colIndex, this.shouldShowWeekNumbers())}`;
        cell.style.gridRow = '1';
        if (date.getFullYear() !== referenceMonth.year || date.getMonth() !== referenceMonth.month) {
            cell.addClass('is-outside-month');
        }
        if (dateKey === todayKey) {
            cell.addClass('is-today');
        }

        const headerRow = cell.createDiv('cal-day-cell__header');

        const astronomyDisplay = getEffectiveAstronomyDisplay(
            this.astronomyDisplay,
            this.plugin.settings.astronomy,
        );
        if (astronomyDisplay.moonPhase) {
            attachMoonPhase(headerRow, dateKey, { size: 14, modifier: 'moon-phase-inline--cal' });
        }

        const dayTarget = linkTarget(dailyNotes(this.app), dateKey);
        const dateLink = headerRow.createEl('a', { cls: 'internal-link' });
        dateLink.createSpan({ cls: 'cal-day-cell__date-label', text: dateLabel });
        dateLink.dataset.href = dayTarget;
        dateLink.setAttribute('href', dayTarget);
        dateLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            void openPeriodicNoteInLeaf(this.app, this.plugin.getOperations(), dailyNotes(this.app), dateKey);
        });

        this.linkInteractionManager.bind(cell, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.hoverParent,
        }, { bindClick: false });
    }

    private renderWeekTasks(weekRow: HTMLElement, weekDates: string[], allTasks: DisplayTask[], reconciler: CardReconciler): void {
        const startHour = this.plugin.settings.startHour;
        // Calendar 月セルは calendar day ベースで 1 セル = 1 日。startHour 境界
        // (visual-date split) を視覚化する意味はなく、入れると view 内部に
        // 不要な dashed boundary が現れる。週行が物理的に分かれることによる
        // per-week split (date-range) のみ適用する。
        const weekSplit = splitTasks(allTasks, { type: 'date-range', start: weekDates[0], end: weekDates[weekDates.length - 1], startHour });
        const entries = computeGridLayout(weekSplit, {
            dates: weekDates,
            getDateRange: (task) => {
                const range = getTaskDateRange(task as DisplayTask, startHour);
                if (!range.effectiveStart) return null;
                return { effectiveStart: range.effectiveStart, effectiveEnd: range.effectiveEnd || range.effectiveStart };
            },
            computeDueArrows: true,
        });

        // Set grid-template-rows based on track count
        let maxTrackIndex = -1;
        for (const entry of entries) {
            if (entry.trackIndex > maxTrackIndex) maxTrackIndex = entry.trackIndex;
        }
        if (maxTrackIndex >= 0) {
            const trackCount = maxTrackIndex + 1;
            weekRow.style.gridTemplateRows = `var(--calendar-header-height) repeat(${trackCount}, minmax(var(--calendar-track-height), auto))`;
        }

        const colOffset = getColumnOffset(this.shouldShowWeekNumbers());

        for (const entry of entries) {
            this.renderGridTask(weekRow, entry, colOffset, reconciler);

            if (entry.dueArrow) {
                renderDueArrow(weekRow, entry, {
                    gridRowOffset: 2,
                    gridColOffset: colOffset,
                });
            }
        }
    }

    private getVisibleTasksInRange(rangeStart: string, rangeEnd: string): DisplayTask[] {
        const filterState = this.viewFilterMenu.getFilterState();
        return this.readService.getTasksForDateRange(rangeStart, rangeEnd, filterState);
    }

    private renderGridTask(
        weekRow: HTMLElement,
        entry: GridTaskEntry,
        colOffset: number,
        reconciler: CardReconciler,
    ): void {
        if (entry.useBarVariant) {
            const key = { scope: 'lane-multi', name: entry.segmentId };
            const reused = reconciler.acquire(key, entry.task);
            const barEl = reused ?? weekRow.createDiv('task-card task-card--multi-day');
            markHandleSurface(barEl, 'grid');
            if (reused) weekRow.appendChild(reused);

            this.decorateCalendarBar(barEl, entry, colOffset);
            this.taskRenderer.render(barEl, entry.task as DisplayTask, this.plugin.settings, {
                key,
                topRight: { mode: 'none' },
                compact: true,
            });
            return;
        }

        const key = { scope: 'lane', name: entry.task.id };
        const reused = reconciler.acquire(key, entry.task);
        const card = reused ?? weekRow.createDiv('task-card');
        markHandleSurface(card, 'grid');
        if (reused) weekRow.appendChild(reused);

        this.applyCalendarGridPosition(card, entry, colOffset);
        this.taskRenderer.render(card, entry.task as DisplayTask, this.plugin.settings, {
            key,
            topRight: { mode: 'time' },
            compact: true,
        });
    }

    /**
     * Idempotent decoration for calendar multi-day bar cards. Variant classes
     * are reset before applying the current entry's split state.
     */
    private decorateCalendarBar(el: HTMLElement, entry: GridTaskEntry, colOffset: number): void {
        // task-card--multi-day is the bar's defining class and stays.
        el.removeClass('task-card--split-continues-before');
        el.removeClass('task-card--split-continues-after');
        if (entry.continuesBefore) el.addClass('task-card--split-continues-before');
        if (entry.continuesAfter) el.addClass('task-card--split-continues-after');

        this.applyCalendarGridPosition(el, entry, colOffset);
    }

    private applyCalendarGridPosition(el: HTMLElement, entry: GridTaskEntry, colOffset: number): void {
        el.style.gridColumn = `${entry.colStart + colOffset} / span ${entry.span}`;
        el.style.gridRow = `${entry.trackIndex + 2}`;
        el.dataset.colStart = `${entry.colStart}`;
        el.dataset.span = `${entry.span}`;
        el.dataset.trackIndex = `${entry.trackIndex}`;
    }

    private getViewStartDateString(): string {
        const { startDate } = this.getCalendarDateRange();
        return DateUtils.getLocalDateString(startDate);
    }

    private getViewEndDateString(): string {
        const { endDate } = this.getCalendarDateRange();
        return DateUtils.getLocalDateString(endDate);
    }

    private getCalendarDateRange(): { startDate: Date; endDate: Date } {
        return getCalendarDateRange(this.windowStart, this.plugin.settings.weekStartDay);
    }

    /**
     * The date range currently drawn, for image export. Calls the same
     * `getCalendarDateRange()` the grid renders from (line ~492) — the
     * week-aligned 42-day window, not the calendar month — so this can't
     * drift from what's actually on screen.
     */
    getExportedDateRange(): { anchor: string; from: string; to: string } | null {
        const { startDate, endDate } = this.getCalendarDateRange();
        return {
            anchor: this.windowStart,
            from: DateUtils.getLocalDateString(startDate),
            to: DateUtils.getLocalDateString(endDate),
        };
    }

    private getWeekdayNames(): string[] {
        const labels = t('calendar.weekdaysShort').split(',');
        if (this.plugin.settings.weekStartDay === 1) {
            return [...labels.slice(1), labels[0]];
        }
        return labels;
    }

    private shouldShowWeekNumbers(): boolean {
        return this.plugin.settings.calendarShowWeekNumbers;
    }

    private renderWeekNumberCell(weekRow: HTMLElement, weekStartDate: Date): void {
        const weekNumberEl = weekRow.createDiv('cal-week-number');
        const weekNumber = withWeekStartDay(weekStartDate, this.plugin.settings.weekStartDay).week();

        const todayWeekStart = DateUtils.getWeekStart(new Date(), this.plugin.settings.weekStartDay);
        if (DateUtils.getLocalDateString(weekStartDate) === DateUtils.getLocalDateString(todayWeekStart)) {
            weekNumberEl.addClass('is-current-week');
        }

        const weekLinkTarget = linkTarget(periodicNotes(this.plugin.settings, 'weekly'), DateUtils.getLocalDateString(weekStartDate));
        const weekLink = weekNumberEl.createEl('a', { cls: 'internal-link' });
        weekLink.createSpan({
            cls: 'cal-week-number__label',
            text: `W${String(weekNumber).padStart(2, '0')}`,
        });
        weekLink.dataset.href = weekLinkTarget;
        weekLink.setAttribute('href', weekLinkTarget);
        weekLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });
        this.linkInteractionManager.bind(weekNumberEl, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.hoverParent,
        }, { bindClick: false });
        weekNumberEl.addEventListener('click', () => {
            void openPeriodicNoteInLeaf(this.app, this.plugin.getOperations(), periodicNotes(this.plugin.settings, 'weekly'), DateUtils.getLocalDateString(weekStartDate));
        });
    }

    private getReferenceMonth(): { year: number; month: number } {
        return getReferenceMonth(this.windowStart);
    }

    private navigateWeek(offset: number): void {
        this.windowStart = DateUtils.addDays(this.windowStart, offset * 7);
        void this.app.workspace.requestSaveLayout();
        this.render();
    }

    /**
     * Show the month that contains `date`, laid out from the week of its 1st.
     * The Today button and "Go to date" both land here, so a
     * picked date and "today" line up the same way.
     */
    private showMonthOf(date: Date): void {
        this.windowStart = DateUtils.getMonthGridStart(date, this.plugin.settings.weekStartDay);
        void this.app.workspace.requestSaveLayout();
        this.render();
    }
}
