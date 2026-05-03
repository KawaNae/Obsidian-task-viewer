import { ItemView, TFile, WorkspaceLeaf, setIcon, type ViewStateResult } from 'obsidian';
import { t } from '../../i18n';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { Task, DisplayTask, PinnedListDefinition } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskWriteService } from '../../services/data/TaskWriteService';
import { ChildLineMenuBuilder } from '../../interaction/menu/builders/ChildLineMenuBuilder';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { MOBILE_BREAKPOINT_PX } from '../../constants/layout';
import {
    getTaskDateRange,
    isTaskCompleted as isTaskCompletedUtil,
    parseLocalDateString,
    getCalendarDateRange,
    getWeekStart,
    getNormalizedWindowStart,
    getReferenceMonth,
    getColumnOffset,
    getGridColumnForDay,
    openOrCreateDailyNote,
} from './CalendarDateUtils';
import { DragHandler } from '../../interaction/drag/DragHandler';
import TaskViewerPlugin from '../../main';
import { TaskStyling } from '../sharedUI/TaskStyling';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import { createEmptyFilterState, hasConditions, type FilterState } from '../../services/filter/FilterTypes';
import { CalendarToolbar } from './CalendarToolbar';
import { createEmptySortState } from '../../services/sort/SortTypes';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { VIEW_META_CALENDAR } from '../../constants/viewRegistry';
import { HandleManager } from '../timelineview/HandleManager';
import { TaskIdGenerator } from '../../services/display/TaskIdGenerator';
import { SidebarManager } from '../sidebar/SidebarManager';
import { PinnedListRenderer } from '../sharedUI/PinnedListRenderer';
import { RenderController } from '../sharedUI/RenderController';
import { computeGridLayout, GridTaskEntry } from '../sharedLogic/GridTaskLayout';
import { renderDueArrow } from '../sharedUI/DueArrowRenderer';
import { splitTasks } from '../../services/display/TaskSplitter';
import { TaskDetailModal } from '../../modals/TaskDetailModal';

export const VIEW_TYPE_CALENDAR = VIEW_META_CALENDAR.type;

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
}

export class CalendarView extends ItemView {
    private readonly plugin: TaskViewerPlugin;
    private readonly readService: TaskReadService;
    private readonly writeService: TaskWriteService;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly filterMenu = new FilterMenuComponent();
    private readonly sidebarSortMenu = new SortMenuComponent();

    private menuHandler: MenuHandler;
    private dragHandler: DragHandler | null = null;
    private handleManager: HandleManager | null = null;
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
    private sidebarFilterMenu = new FilterMenuComponent();
    private toolbar: CalendarToolbar;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private unsubscribeDelete: (() => void) | null = null;
    private windowStart: string;
    private showSidebar = true;
    private pinnedListCollapsed: Record<string, boolean> = {};
    private pinnedLists: PinnedListDefinition[] = [];
    private customName: string | undefined;
    private scrollRestorePending = false;
    private savedScrollTop: number | null = null;
    private sidebarOpenedThisSession = false;
    private readonly hoverParent = new TaskViewHoverParent();
    private renderController: RenderController;

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.readService = plugin.getTaskReadService();
        this.writeService = plugin.getTaskWriteService();
        this.taskRenderer = new TaskCardRenderer(this.app, this.readService, this.writeService, this.plugin.menuPresenter, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.hoverParent,
        }, () => this.plugin.settings);
        this.addChild(this.taskRenderer);
        this.taskRenderer.setDetailCallback((task) => {
            new TaskDetailModal(this.app, task, this.taskRenderer, this.menuHandler, this.plugin.settings, this.readService).open();
        });
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
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
        this.windowStart = DateUtils.getLocalDateString(weekStart);
        this.filterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.filterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.filterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);
        this.sidebarFilterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.sidebarFilterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.sidebarFilterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);

        this.toolbar = new CalendarToolbar({
            app: this.app,
            leaf: this.leaf,
            plugin: this.plugin,
            readService: this.readService,
            filterMenu: this.filterMenu,
            container: this.containerEl,
            onNavigateWeek: (days) => this.navigateWeek(days),
            onNavigateMonth: (direction) => this.navigateMonth(direction),
            onJumpToCurrentMonth: () => {
                const today = new Date();
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
                void this.app.workspace.requestSaveLayout();
                this.render();
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
            onApplyTemplate: (template) => {
                if (template.pinnedLists) this.pinnedLists = template.pinnedLists;
                if (template.showSidebar != null) {
                    if (template.showSidebar) this.sidebarOpenedThisSession = true;
                    this.showSidebar = template.showSidebar;
                    this.sidebarManager.applyOpen(template.showSidebar, { persist: true });
                }
                if (template.name) {
                    this.customName = template.name;
                    this.leaf.updateHeader();
                }
                this.app.workspace.requestSaveLayout();
                this.render();
                this.pinnedListRenderer?.refresh();
            },
            onReset: () => {
                this.pinnedLists = [];
                this.sidebarOpenedThisSession = true;
                this.showSidebar = true;
                this.sidebarManager.applyOpen(true, { persist: true });
                this.customName = undefined;
                this.leaf.updateHeader();
                this.app.workspace.requestSaveLayout();
                this.render();
                this.pinnedListRenderer?.refresh();
            },
        });
    }

    getViewType(): string {
        return VIEW_TYPE_CALENDAR;
    }

    getDisplayText(): string {
        return this.customName || VIEW_META_CALENDAR.displayText;
    }

    getIcon(): string {
        return VIEW_META_CALENDAR.icon;
    }

    async setState(state: CalendarViewState, result: ViewStateResult): Promise<void> {
        if (state && typeof state.windowStart === 'string') {
            const parsedWindowStart = this.parseLocalDateString(state.windowStart);
            if (parsedWindowStart) {
                const weekStart = this.getWeekStart(parsedWindowStart, this.plugin.settings.calendarWeekStartDay);
                this.windowStart = DateUtils.getLocalDateString(weekStart);
            }
        }

        if (state && state.filterState) {
            this.filterMenu.setFilterState(FilterSerializer.fromJSON(state.filterState));
        } else {
            this.filterMenu.setFilterState(createEmptyFilterState());
        }

        if (typeof state?.showSidebar === 'boolean') {
            this.showSidebar = state.showSidebar;
            this.sidebarManager.applyOpen(state.showSidebar, { animate: false });
        }
        if (state?.pinnedListCollapsed) {
            // Migrate legacy un-prefixed keys (pre-viewId-namespacing) to the
            // current `${viewId}::${listId}` form. One-shot at deserialize.
            this.pinnedListCollapsed = this.migrateCollapsedKeys(state.pinnedListCollapsed);
        }
        if (Array.isArray(state?.pinnedLists)) {
            this.pinnedLists = state.pinnedLists;
        }
        if (typeof state?.customName === 'string' && state.customName.trim()) {
            this.customName = state.customName;
        } else {
            this.customName = undefined;
        }
        await super.setState(state, result);
        await this.performRender();
        // setState may have changed filterState / pinnedLists / collapse — none
        // of these go through readService.onChange, so PinnedList wouldn't
        // otherwise refresh. (Safe to call even before attach: refresh() no-ops
        // when not attached.)
        this.pinnedListRenderer?.refresh();
    }

    getState(): Record<string, unknown> {
        const filterState = this.filterMenu.getFilterState();
        const result: Record<string, unknown> = {
            windowStart: this.windowStart,
        };
        if (hasConditions(filterState)) {
            result.filterState = FilterSerializer.toJSON(filterState);
        }
        result.showSidebar = this.showSidebar;
        if (Object.keys(this.pinnedListCollapsed).length > 0) {
            result.pinnedListCollapsed = this.pinnedListCollapsed;
        }
        if (this.pinnedLists.length > 0) {
            result.pinnedLists = this.pinnedLists;
        }
        if (this.customName) {
            result.customName = this.customName;
        }
        return result;
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('calendar-view');
        this.sidebarManager.attach(this.container, (el, ev, handler) =>
            this.registerDomEvent(el as any, ev as any, handler),
        );

        this.menuHandler = new MenuHandler(this.app, this.readService, this.writeService, this.plugin);
        this.taskRenderer.setChildMenuCallback((taskId, x, y) => this.menuHandler.showMenuForTask(taskId, x, y));
        const childLineMenuBuilder = new ChildLineMenuBuilder(this.app, this.writeService, this.plugin);
        this.taskRenderer.setChildLineEditCallback((parentTask, line, bodyLine, x, y) => {
            childLineMenuBuilder.showMenu(parentTask, line, bodyLine, x, y);
        });
        this.pinnedListRenderer = new PinnedListRenderer(
            this.taskRenderer, this.plugin, this.menuHandler, this.readService,
        );
        // Persistent host for pinned lists. Lives outside the empty() target —
        // detached before container.empty() in performRender and reparented
        // into the freshly-built sidebarBody after.
        this.pinnedHost = document.createElement('div');
        this.pinnedListRenderer.attach({
            host: this.pinnedHost,
            getLists: () => this.pinnedLists,
            getCollapsed: () => this.buildCollapsedStateForRenderer(),
            getViewFilterState: () => this.filterMenu.getFilterState(),
            callbacks: this.getPinnedListCallbacks(),
            viewId: VIEW_ID,
        });
        this.handleManager = new HandleManager(this.container, {
            getTask: (id) => this.readService.getTask(id),
            getStartHour: () => this.plugin.settings.startHour,
        });
        this.dragHandler = new DragHandler(
            this.container,
            this.readService,
            this.writeService,
            this.plugin,
            (taskId: string) => {
                // Store base task id so split segments all share one selection and
                // the selection survives a drag-move that regenerates segment ids.
                const baseId = TaskIdGenerator.parseSegmentId(taskId)?.baseId ?? taskId;
                this.handleManager?.selectTask(baseId);
            },
            () => { /* no-op: handles are inside task cards */ },
            () => this.getViewStartDateString(),
            () => this.plugin.settings.zoomLevel
        );
        this.dragHandler.onDetailClick = (taskId: string) => {
            const task = this.readService.getTask(taskId);
            if (task) {
                new TaskDetailModal(this.app, task, this.taskRenderer, this.menuHandler, this.plugin.settings, this.readService).open();
            }
        };

        this.container.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('.task-card__handle-btn')) {
                return;
            }
            if (!target.closest('.task-card')) {
                this.handleManager?.selectTask(null);
            }
        });

        await this.performRender();

        // Clear selection when the selected task is deleted via the UI.
        this.unsubscribeDelete = this.writeService.onTaskDeleted((deletedId) => {
            if (this.handleManager?.getSelectedTaskId() === deletedId) {
                this.handleManager.selectTask(null);
            }
        });

        // Initialize render dispatch controller. CalendarView は partial 未対応のため
        // tryPartial は常に false（→ 必ず full render に降格）。
        this.renderController = new RenderController({
            tryPartial: () => false,
            performFull: () => this.render(),
            refreshPinned: () => { /* partial 未対応なので呼ばれない */ },
        });

        this.unsubscribe = this.readService.onChange((taskId, changes) => {
            this.renderController.handleChange(taskId, changes);
        });
    }

    async onClose(): Promise<void> {
        this.hoverParent.dispose();
        this.filterMenu.close();
        this.sidebarFilterMenu.close();
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
        this.renderController?.dispose();
    }

    public refresh(): void {
        this.render();
    }

    private render(): void {
        if (!this.scrollRestorePending) {
            const oldMain = this.container?.querySelector('.cal-grid__body') as HTMLElement | null;
            if (oldMain) {
                this.savedScrollTop = oldMain.scrollTop;
            }
        }
        void this.performRender();
    }

    private async performRender(): Promise<void> {
        if (!this.container) {
            return;
        }

        const normalizedWindowStart = this.getNormalizedWindowStart(this.windowStart);
        if (normalizedWindowStart !== this.windowStart) {
            this.windowStart = normalizedWindowStart;
        }

        // On narrow/mobile, force sidebar closed unless user explicitly opened it this session
        if (this.sidebarManager.isNarrow() && !this.sidebarOpenedThisSession) {
            this.showSidebar = false;
        }
        this.sidebarManager.syncPresentation(this.showSidebar, { animate: false });
        this.toolbar.detach();
        this.taskRenderer.disposeInside(this.container);
        // Detach the persistent pinnedHost so its DOM (and PinnedListRenderer's
        // internal subscription / paging / collapse state) survives the empty().
        // Re-appended into the freshly-built sidebarBody by renderSidebarContent.
        if (this.pinnedHost?.parentElement) {
            this.pinnedHost.parentElement.removeChild(this.pinnedHost);
        }
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

            await this.renderWeekTasks(weekRow, weekDates, allVisibleTasks);
        }

        const toolbarRootEl = this.toolbar.getRootEl();
        if (toolbarRootEl) {
            toolbarRootEl.dataset.range = `${rangeStartStr}:${rangeEndStr}`;
        }

        // Attach handles to the selected card. Section renderers already
        // tagged cards with `.is-selected` during render; reapplySelectionClass is
        // idempotent and ensures handles are attached on the fresh DOM.
        if (this.handleManager?.getSelectedTaskId()) {
            this.handleManager.reapplySelectionClass();
        }

        if (this.savedScrollTop !== null) {
            this.scrollRestorePending = true;
            const scrollTarget = this.savedScrollTop;
            requestAnimationFrame(() => {
                this.scrollRestorePending = false;
                const newMain = this.container.querySelector('.cal-grid__body') as HTMLElement | null;
                if (newMain) {
                    newMain.scrollTop = scrollTarget;
                }
            });
        }
    }

    private renderSidebarContent(header: HTMLElement, body: HTMLElement): void {
        header.createEl('p', { cls: 'tv-sidebar__panel-title', text: t('pinnedList.pinnedLists') });

        const addBtn = header.createEl('button', { cls: 'tv-sidebar__panel-add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.appendText(t('pinnedList.addList'));
        addBtn.addEventListener('click', () => {
            const newId = 'pl-' + Date.now();
            this.pinnedLists.push({
                id: newId,
                name: t('pinnedList.newList'),
                filterState: createEmptyFilterState(),
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
                    filterState: structuredClone(listDef.filterState),
                    sortState: listDef.sortState ? structuredClone(listDef.sortState) : undefined,
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

    /**
     * One-shot migration: any key without `::` is assumed to be a legacy
     * listId-only entry from before viewId-namespacing was introduced.
     * Prefix it with `${viewId}::` so calendar owns it.
     */
    private migrateCollapsedKeys(stored: Record<string, boolean>): Record<string, boolean> {
        const migrated: Record<string, boolean> = {};
        for (const [key, val] of Object.entries(stored)) {
            if (key.includes('::')) {
                migrated[key] = val;
            } else {
                migrated[`${COLLAPSE_KEY_PREFIX}${key}`] = val;
            }
        }
        return migrated;
    }

    private openPinnedListSort(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sidebarSortMenu.setSortState(listDef.sortState ?? createEmptySortState());
        this.sidebarSortMenu.showMenuAtElement(anchorEl, {
            onSortChange: () => {
                listDef.sortState = this.sidebarSortMenu.getSortState();
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
        });
    }

    private openPinnedListFilter(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sidebarFilterMenu.setFilterState(listDef.filterState);
        this.sidebarFilterMenu.showMenuAtElement(anchorEl, {
            onFilterChange: () => {
                listDef.filterState = this.sidebarFilterMenu.getFilterState();
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
            getTasks: () => this.readService.getTasks(),
            getStartHour: () => this.plugin.settings.startHour,
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
        const header = weekRow.createDiv('cal-day-cell');
        const dateKey = DateUtils.getLocalDateString(date);
        const todayKey = DateUtils.getLocalDateString(new Date());
        const isFirstOfMonth = date.getDate() === 1;
        const dateLabel = isFirstOfMonth
            ? dateKey
            : `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        header.style.gridColumn = `${this.getGridColumnForDay(colIndex)}`;
        header.style.gridRow = '1';
        if (colIndex === 7) {
            header.addClass('is-last-col');
        }

        if (date.getFullYear() !== referenceMonth.year || date.getMonth() !== referenceMonth.month) {
            header.addClass('is-outside-month');
        }
        if (dateKey === todayKey) {
            header.addClass('is-today');
        }

        const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(this.app, date);
        const dateLink = header.createEl('a', {
            cls: 'internal-link',
            text: dateLabel,
        });
        dateLink.dataset.href = linkTarget;
        dateLink.setAttribute('href', linkTarget);
        dateLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            void this.openOrCreateDailyNote(date);
        });

        this.linkInteractionManager.bind(header, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.hoverParent,
        }, { bindClick: false });
    }

    private async renderWeekTasks(weekRow: HTMLElement, weekDates: string[], allTasks: DisplayTask[]): Promise<void> {
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

        await Promise.all(entries.map(async (entry) => {
            await this.renderGridTask(weekRow, entry, colOffset);

            if (entry.dueArrow) {
                renderDueArrow(weekRow, entry, {
                    gridRowOffset: 2,
                    gridColOffset: colOffset,
                });
            }
        }));
    }

    private getVisibleTasksInRange(rangeStart: string, rangeEnd: string): DisplayTask[] {
        const filterState = this.filterMenu.getFilterState();
        return this.readService.getTasksForDateRange(rangeStart, rangeEnd, filterState);
    }

    private async renderGridTask(
        weekRow: HTMLElement,
        entry: GridTaskEntry,
        colOffset: number,
    ): Promise<void> {
        const applyGridPosition = (el: HTMLElement) => {
            el.style.gridColumn = `${entry.colStart + colOffset} / span ${entry.span}`;
            el.style.gridRow = `${entry.trackIndex + 2}`;
            el.dataset.colStart = `${entry.colStart}`;
            el.dataset.span = `${entry.span}`;
            el.dataset.trackIndex = `${entry.trackIndex}`;
        };

        if (entry.isMultiDay || entry.continuesBefore || entry.continuesAfter) {
            const barEl = weekRow.createDiv('task-card task-card--multi-day');
            barEl.createDiv('task-card__shape');
            barEl.dataset.id = entry.segmentId;
            if (entry.continuesBefore || entry.continuesAfter) {
                barEl.dataset.splitOriginalId = (entry.task as DisplayTask).originalTaskId || entry.task.id;
            }
            applyGridPosition(barEl);

            if (entry.continuesBefore) barEl.addClass('task-card--split-continues-before');
            if (entry.continuesAfter) barEl.addClass('task-card--split-continues-after');

            TaskStyling.applyTaskColor(barEl, entry.task.color ?? null);
            TaskStyling.applyTaskLinestyle(barEl, entry.task.linestyle ?? null);
            TaskStyling.applyReadOnly(barEl, entry.task);

            this.menuHandler.addTaskContextMenu(barEl, entry.task);
            await this.taskRenderer.render(barEl, entry.task, this.plugin.settings, {
                cardInstanceId: `${VIEW_ID}::lane-multi::${entry.segmentId}`,
                topRight: 'none',
                compact: true,
            });
            return;
        }

        const card = weekRow.createDiv('task-card');
        card.createDiv('task-card__shape');
        card.dataset.id = entry.task.id;
        applyGridPosition(card);

        TaskStyling.applyTaskColor(card, entry.task.color ?? null);
        TaskStyling.applyTaskLinestyle(card, entry.task.linestyle ?? null);
        TaskStyling.applyReadOnly(card, entry.task);
        this.menuHandler.addTaskContextMenu(card, entry.task);
        await this.taskRenderer.render(card, entry.task, this.plugin.settings, {
            cardInstanceId: `${VIEW_ID}::lane::${entry.task.id}`,
            compact: true,
        });
    }

    private isTaskCompleted(task: DisplayTask): boolean {
        return isTaskCompletedUtil(task, this.plugin.settings.statusDefinitions, this.readService);
    }

    private getViewStartDateString(): string {
        const { startDate } = this.getCalendarDateRange();
        return DateUtils.getLocalDateString(startDate);
    }

    private getCalendarDateRange(): { startDate: Date; endDate: Date } {
        return getCalendarDateRange(this.windowStart, this.plugin.settings.calendarWeekStartDay);
    }

    private getWeekStart(date: Date, weekStartDay: 0 | 1): Date {
        return getWeekStart(date, weekStartDay);
    }

    private getWeekdayNames(): string[] {
        const labels = t('calendar.weekdaysShort').split(',');
        if (this.plugin.settings.calendarWeekStartDay === 1) {
            return [...labels.slice(1), labels[0]];
        }
        return labels;
    }

    private shouldShowWeekNumbers(): boolean {
        return this.plugin.settings.calendarShowWeekNumbers;
    }

    private getColumnOffset(): number {
        return getColumnOffset(this.shouldShowWeekNumbers());
    }

    private getGridColumnForDay(dayColumn: number): number {
        return getGridColumnForDay(dayColumn, this.shouldShowWeekNumbers());
    }

    private renderWeekNumberCell(weekRow: HTMLElement, weekStartDate: Date): void {
        const weekNumberEl = weekRow.createDiv('cal-week-number');
        const weekNumber = DateUtils.getISOWeekNumber(weekStartDate);

        const todayWeekStart = this.getWeekStart(new Date(), this.plugin.settings.calendarWeekStartDay);
        if (DateUtils.getLocalDateString(weekStartDate) === DateUtils.getLocalDateString(todayWeekStart)) {
            weekNumberEl.addClass('is-current-week');
        }

        const weekLinkTarget = DailyNoteUtils.getWeeklyNoteLinkTarget(this.plugin.settings, weekStartDate);
        const weekLink = weekNumberEl.createEl('a', {
            cls: 'internal-link',
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
            void this.openOrCreatePeriodicNote(weekStartDate);
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

    private navigateMonth(offset: number): void {
        const ref = this.getReferenceMonth();
        const monthStart = new Date(ref.year, ref.month + offset, 1);
        const weekStart = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
        this.windowStart = DateUtils.getLocalDateString(weekStart);
        void this.app.workspace.requestSaveLayout();
        this.render();
    }

    private parseLocalDateString(value: string): Date | null {
        return parseLocalDateString(value);
    }

    private getNormalizedWindowStart(value: string): string {
        return getNormalizedWindowStart(value, this.plugin.settings.calendarWeekStartDay);
    }

    private async openOrCreateDailyNote(date: Date): Promise<void> {
        return openOrCreateDailyNote(this.app, date);
    }

    private async openOrCreatePeriodicNote(date: Date): Promise<void> {
        const settings = this.plugin.settings;
        let file: TFile | null = DailyNoteUtils.getWeeklyNote(this.app, settings, date);
        if (!file) {
            file = await DailyNoteUtils.createWeeklyNote(this.app, settings, date);
        }
        if (file) {
            await this.app.workspace.getLeaf(false).openFile(file);
        }
    }
}
