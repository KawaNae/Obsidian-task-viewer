import { ItemView, WorkspaceLeaf, setIcon, type Workspace, type ViewStateResult } from 'obsidian';
import { t } from '../../i18n';
import { ViewUriBuilder } from '../sharedLogic/ViewUriBuilder';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { ViewState, PinnedListDefinition } from '../../types';
import { findOldestOverdueDate } from '../../services/display/OverdueTaskFinder';
import { DragHandler } from '../../interaction/drag/DragHandler';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { TaskDetailModal } from '../../modals/TaskDetailModal';

import { DateUtils } from '../../utils/DateUtils';
import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskWriteService } from '../../services/data/TaskWriteService';
import { ChildLineMenuBuilder } from '../../interaction/menu/builders/ChildLineMenuBuilder';

import TaskViewerPlugin from '../../main';
import { MOBILE_BREAKPOINT_PX } from '../../constants/layout';

import { HandleManager } from './HandleManager';
import { TimelineToolbar } from './TimelineToolbar';
import { TaskIdGenerator } from '../../services/display/TaskIdGenerator';

import { GridRenderer } from './renderers/GridRenderer';
import { AllDaySectionRenderer } from '../sharedUI/AllDaySectionRenderer';
import { TimelineSectionRenderer } from './renderers/TimelineSectionRenderer';
import { PinnedListRenderer, type PinnedListCallbacks } from '../sharedUI/PinnedListRenderer';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { createEmptyFilterState, type FilterState } from '../../services/filter/FilterTypes';
import { createEmptySortState } from '../../services/sort/SortTypes';
import { HabitTrackerRenderer } from '../sharedUI/HabitTrackerRenderer';
import { SidebarManager } from '../sidebar/SidebarManager';
import { TaskStyling } from '../sharedUI/TaskStyling';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';

export const VIEW_TYPE_TIMELINE = VIEW_META_TIMELINE.type;

/**
 * View id used as a namespace prefix for shared viewState fields whose keys
 * collide between views (e.g. pinnedListCollapsed). Lets timeline and calendar
 * own independent collapse state for the same listId.
 */
const VIEW_ID = 'timeline';
const COLLAPSE_KEY_PREFIX = `${VIEW_ID}::`;

/** Keys that change task position on the grid → full render */
const LAYOUT_KEYS = new Set(['startDate', 'startTime', 'endDate', 'endTime', 'due']);
/** Keys safe for partial DOM update (no position change) */
const SAFE_KEYS = new Set(['status', 'statusChar', 'content', 'childLines']);
/** Keys with zero visual effect → skip render entirely */
const NO_RENDER_KEYS = new Set(['blockId', 'timerTargetId']);

/**
 * Timeline View - Displays tasks on a time-based grid layout.
 * 
 * Structure:
 * - Lifecycle: constructor, onOpen, onClose, refresh
 * - Core Rendering: render, renderCurrentTimeIndicator
 * - Grid & Layout: renderGrid, getDatesToShow, renderTimeLabels
 * - Section Renderers: renderFutureSection, renderLongTermTasks, renderTimedTasks
 * - Color & Styling: applyTaskColor
 * - Task Creation: addCreateTaskListeners, handleCreateTaskTrigger
 */
interface TimelineViewState {
    daysToShow?: number;
    zoomLevel?: number;
    startDate?: string;
    filterState?: FilterState;
    showSidebar?: boolean;
    pinnedListCollapsed?: Record<string, boolean>;
    pinnedLists?: PinnedListDefinition[];
    customName?: string;
}

export class TimelineView extends ItemView {
    // ==================== Services & Handlers ====================
    private readService: TaskReadService;
    private writeService: TaskWriteService;
    private plugin: TaskViewerPlugin;
    private taskRenderer: TaskCardRenderer;
    private dragHandler: DragHandler;
    private menuHandler: MenuHandler;
    private handleManager: HandleManager;
    private toolbar: TimelineToolbar | undefined;
    private sidebarManager: SidebarManager;

    // ==================== Renderers ====================
    private gridRenderer: GridRenderer;
    private allDayRenderer: AllDaySectionRenderer;
    private timelineRenderer: TimelineSectionRenderer;
    private pinnedListRenderer: PinnedListRenderer;
    private sidebarFilterMenu = new FilterMenuComponent();
    private sidebarSortMenu = new SortMenuComponent();
    private habitRenderer: HabitTrackerRenderer;

    // ==================== State ====================
    private container: HTMLElement;
    private viewState: ViewState;
    private unsubscribe: (() => void) | null = null;
    private unsubscribeDelete: (() => void) | null = null;
    private currentTimeInterval: number | null = null;
    private savedScrollTop: number | null = null;
    private scrollToNowOnNextRender = false;
    private hasInitializedStartDate: boolean = false;

    // Render coalescing (frame-level): 同一 frame 内に複数の onChange が来ても render は 1 回
    private renderRafId: number | null = null;
    private renderDirty = false;

    // ==================== Pinch zoom state ====================
    private pinchInitialDistance: number = 0;
    private pinchInitialZoom: number = 1;
    private pinchInitialMidY: number = 0;
    private pinchInitialScrollTop: number = 0;
    private isPinching: boolean = false;
    private sidebarOpenedThisSession = false;
    private readonly hoverParent = new TaskViewHoverParent();

    // ==================== Lifecycle ====================

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) {
        super(leaf);
        this.readService = plugin.getTaskReadService();
        this.writeService = plugin.getTaskWriteService();
        this.plugin = plugin;
        this.viewState = {
            startDate: DateUtils.getVisualDateOfNow(this.plugin.settings.startHour),
            daysToShow: 3,
            showSidebar: true,
            pinnedLists: [],
        };
        this.sidebarManager = new SidebarManager({
            mobileBreakpointPx: MOBILE_BREAKPOINT_PX,
            onPersist: () => this.app.workspace.requestSaveLayout(),
            onSyncToggleButton: () => this.toolbar?.syncSidebarToggleState(),
            onRequestClose: () => {
                this.viewState.showSidebar = false;
                this.sidebarManager.applyOpen(false, { animate: true, persist: true });
            },
            getIsOpen: () => this.viewState.showSidebar,
        });
        this.taskRenderer = new TaskCardRenderer(this.app, this.readService, this.writeService, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.hoverParent,
        }, () => this.plugin.settings);
        this.addChild(this.taskRenderer);
    }

    getViewType() {
        return VIEW_TYPE_TIMELINE;
    }

    getDisplayText() {
        return this.viewState.customName || VIEW_META_TIMELINE.displayText;
    }

    getIcon() {
        return VIEW_META_TIMELINE.icon;
    }

    async setState(state: TimelineViewState, result: ViewStateResult): Promise<void> {
        if (state) {
            if (typeof state.daysToShow === 'number') {
                this.viewState.daysToShow = state.daysToShow;
            }
            if (typeof state.zoomLevel === 'number') {
                this.viewState.zoomLevel = state.zoomLevel;
            }
            if (typeof state.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.startDate)) {
                this.viewState.startDate = state.startDate;
            }
            if (state.filterState) {
                this.viewState.filterState = state.filterState;
            } else {
                this.viewState.filterState = undefined;
            }
            if (typeof state.showSidebar === 'boolean') {
                this.viewState.showSidebar = state.showSidebar;
                this.sidebarManager.applyOpen(state.showSidebar, { animate: false });
            }
            if (state.pinnedListCollapsed) {
                // Migrate legacy un-prefixed keys (pre-viewId-namespacing) to the
                // current `${viewId}::${listId}` form. One-shot at deserialize.
                this.viewState.pinnedListCollapsed = this.migrateCollapsedKeys(state.pinnedListCollapsed);
            }
            if (Array.isArray(state.pinnedLists)) {
                this.viewState.pinnedLists = state.pinnedLists;
            }
            if (typeof state.customName === 'string' && state.customName.trim()) {
                this.viewState.customName = state.customName;
            } else {
                this.viewState.customName = undefined;
            }
            // Note: startDate is not restored - always use "Today" logic on reload
        }
        await super.setState(state, result);
        this.render();
    }

    getState() {
        const state: Record<string, unknown> = {
            daysToShow: this.viewState.daysToShow,
            showSidebar: this.viewState.showSidebar,
        };
        if (this.viewState.pinnedListCollapsed && Object.keys(this.viewState.pinnedListCollapsed).length > 0) {
            state.pinnedListCollapsed = this.viewState.pinnedListCollapsed;
        }
        const lists = this.viewState.pinnedLists;
        if (lists && lists.length > 0) {
            state.pinnedLists = lists;
        }
        if (this.viewState.zoomLevel != null) {
            state.zoomLevel = this.viewState.zoomLevel;
        }
        if (this.viewState.filterState) {
            state.filterState = this.viewState.filterState;
        }
        if (this.viewState.customName) {
            state.customName = this.viewState.customName;
        }
        return state;
    }

    async onOpen() {
        // Set initial startDate - will be re-evaluated in onChange when tasks are loaded
        const initialVisualToday = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        this.viewState.startDate = DateUtils.addDays(initialVisualToday, -this.plugin.settings.pastDaysToShow);

        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('timeline-view');
        this.sidebarManager.attach(this.container, (el, ev, handler) =>
            this.registerDomEvent(el as any, ev as any, handler),
        );

        // Initialize MenuHandler
        this.menuHandler = new MenuHandler(this.app, this.readService, this.writeService, this.plugin);
        this.taskRenderer.setChildMenuCallback((taskId, x, y) => this.menuHandler.showMenuForTask(taskId, x, y));
        const childLineMenuBuilder = new ChildLineMenuBuilder(this.app, this.writeService, this.plugin);
        this.taskRenderer.setChildLineEditCallback((parentTask, childLineIndex, x, y) => {
            childLineMenuBuilder.showMenu(parentTask, childLineIndex, x, y);
        });
        this.taskRenderer.setDetailCallback((task) => {
            new TaskDetailModal(this.app, task, this.taskRenderer, this.menuHandler, this.plugin.settings, this.readService).open();
        });

        // Initialize HandleManager
        this.handleManager = new HandleManager(this.container, {
            getTask: (id) => this.readService.getTask(id),
            getStartHour: () => this.plugin.settings.startHour,
        });

        // Toolbar is initialized in performRender() — onOpen does not pre-construct it.
        // Until performRender runs, this.toolbar is undefined; consumers must null-check.

        // Initialize Renderers
        this.allDayRenderer = new AllDaySectionRenderer(this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.viewState.daysToShow);
        this.timelineRenderer = new TimelineSectionRenderer(this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.getEffectiveZoomLevel());
        this.gridRenderer = new GridRenderer(this.container, this.viewState, this.plugin, this.menuHandler, this.hoverParent);
        this.pinnedListRenderer = new PinnedListRenderer(this.taskRenderer, this.plugin, this.menuHandler, this.readService);
        this.habitRenderer = new HabitTrackerRenderer(this.app, this.plugin);
        this.sidebarFilterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.sidebarFilterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.sidebarFilterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);

        // Initialize DragHandler with selection callback, move callback, and view start date provider
        this.dragHandler = new DragHandler(this.container, this.readService, this.writeService, this.plugin,
            (taskId: string) => {
                // Store base task id so split segments all share one selection and
                // the selection survives a drag-move that regenerates segment ids.
                const segInfo = TaskIdGenerator.parseSegmentId(taskId);
                const baseId = segInfo?.baseId ?? taskId;
                this.handleManager.selectTask(baseId);
            },
            () => { /* no-op: handles are inside task cards */ },
            () => this.viewState.startDate,
            () => this.getEffectiveZoomLevel()
        );

        // Background click to deselect
        this.container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // If clicking handle, do nothing (handled by DragHandler or button click)
            if (target.closest('.task-card__handle-btn')) return;

            const cardEl = target.closest('.task-card') as HTMLElement | null;
            if (!cardEl) {
                if (this.handleManager.getSelectedTaskId()) {
                    this.handleManager.selectTask(null);
                }
            }
        });

        // Clear selection when the selected task is deleted via the UI.
        // External-editor deletions are not tracked here by design — if that
        // case causes a visual glitch (line-shifted task inherits `.selected`),
        // user can click to re-select.
        this.unsubscribeDelete = this.writeService.onTaskDeleted((deletedId) => {
            if (this.handleManager.getSelectedTaskId() === deletedId) {
                this.handleManager.selectTask(null);
            }
        });

        // Subscribe to data changes
        this.unsubscribe = this.readService.onChange((taskId, changes) => {
            // On first data load, re-evaluate startDate to include past overdue tasks
            // (no auto-scroll: user-driven scroll only via Now button / refresh / onOpen)
            this.maybeInitializeStartDate();

            if (taskId && changes) {
                if (changes.every(k => NO_RENDER_KEYS.has(k))) return;

                if (changes.some(k => LAYOUT_KEYS.has(k))) {
                    this.scheduleRender();
                    return;
                }

                if (changes.every(k => SAFE_KEYS.has(k))) {
                    if (this.tryPartialUpdate(taskId)) {
                        // partial update は main grid のカードのみ書き換えるので、
                        // pinnedLists の件数 / フィルタ膜割り / ソート位置 / カード内容を
                        // 反映するため pinnedLists だけフル再描画する。
                        this.refreshPinnedLists();
                        return;
                    }
                }
            }

            this.scheduleRender();
        });

        // Ctrl+wheel zoom
        this.registerDomEvent(this.container, 'wheel', (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.25 : -0.25;
            const oldZoom = this.getEffectiveZoomLevel();
            const newZoom = Math.min(10.0, Math.max(0.25, oldZoom + delta));
            if (newZoom === oldZoom) return;

            // Keep the time under cursor stable during zoom when cursor is over scroll area.
            const scrollArea = this.container.querySelector('.timeline-scroll-area') as HTMLElement | null;
            if (scrollArea) {
                const rect = scrollArea.getBoundingClientRect();
                const cursorY = e.clientY - rect.top;
                const isCursorInsideScrollArea = cursorY >= 0 && cursorY <= rect.height;
                if (isCursorInsideScrollArea) {
                    const oldScrollTop = scrollArea.scrollTop;
                    scrollArea.scrollTop = (oldScrollTop + cursorY) * (newZoom / oldZoom) - cursorY;
                }
            }

            this.viewState.zoomLevel = newZoom;
            this.container.style.setProperty('--hour-height', `${60 * newZoom}px`);
            const zoomLabel = this.container.querySelector('.timeline-toolbar__btn--zoom .timeline-toolbar__btn-label');
            if (zoomLabel) {
                zoomLabel.textContent = `${Math.round(newZoom * 100)}%`;
            }
            void this.app.workspace.requestSaveLayout();
        }, { passive: false });

        // Pinch zoom (touch devices)
        this.registerDomEvent(this.container, 'touchstart', (e: TouchEvent) => {
            if (e.touches.length !== 2) return;
            this.isPinching = true;
            this.pinchInitialDistance = this.getTouchDistance(e.touches);
            this.pinchInitialZoom = this.getEffectiveZoomLevel();

            // Capture initial midpoint and scrollTop so scroll correction uses absolute values
            // instead of accumulating per-frame rounding errors.
            const scrollArea = this.container.querySelector('.timeline-scroll-area') as HTMLElement | null;
            if (scrollArea) {
                const rect = scrollArea.getBoundingClientRect();
                this.pinchInitialMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
                this.pinchInitialScrollTop = scrollArea.scrollTop;
            }
        }, { passive: true });

        this.registerDomEvent(this.container, 'touchmove', (e: TouchEvent) => {
            if (!this.isPinching || e.touches.length !== 2) return;
            e.preventDefault();

            const currentDistance = this.getTouchDistance(e.touches);
            if (this.pinchInitialDistance <= 0) return;
            const scale = currentDistance / this.pinchInitialDistance;
            const oldZoom = this.getEffectiveZoomLevel();
            const newZoom = Math.min(10.0, Math.max(0.25, this.pinchInitialZoom * scale));
            if (newZoom === oldZoom) return;

            // Compute scrollTop from initial values (absolute), not from previous frame (relative).
            // This avoids rounding-error accumulation across frames.
            const scrollArea = this.container.querySelector('.timeline-scroll-area') as HTMLElement | null;
            if (scrollArea) {
                const midY = this.pinchInitialMidY;
                if (midY >= 0 && midY <= scrollArea.clientHeight) {
                    scrollArea.scrollTop = (this.pinchInitialScrollTop + midY) * (newZoom / this.pinchInitialZoom) - midY;
                }
            }

            this.viewState.zoomLevel = newZoom;
            this.container.style.setProperty('--hour-height', `${60 * newZoom}px`);
            const zoomLabel = this.container.querySelector('.timeline-toolbar__btn--zoom .timeline-toolbar__btn-label');
            if (zoomLabel) {
                zoomLabel.textContent = `${Math.round(newZoom * 100)}%`;
            }
        }, { passive: false });

        this.registerDomEvent(this.container, 'touchend', (e: TouchEvent) => {
            if (!this.isPinching) return;
            if (e.touches.length < 2) {
                this.isPinching = false;
                void this.app.workspace.requestSaveLayout();
            }
        }, { passive: true });
        this.registerDomEvent(this.container, 'touchcancel', () => {
            if (!this.isPinching) return;
            this.isPinching = false;
            void this.app.workspace.requestSaveLayout();
        }, { passive: true });

        // Start Current Time Interval
        this.currentTimeInterval = window.setInterval(() => {
            this.renderCurrentTimeIndicator();
        }, 60000); // Every minute

        // If task data is already loaded (cached from another view), initialize
        // startDate now — onChange may not fire since there's no new event to deliver.
        this.maybeInitializeStartDate();

        // Initial render — scroll to current time
        this.scrollToNowOnNextRender = true;
        this.render();
    }

    /**
     * On first data load, re-evaluate startDate to include past overdue tasks.
     * Idempotent — safe to call multiple times; only the first call with non-empty
     * tasks takes effect. Called from both onOpen (covers cached-data case) and
     * onChange (covers async-load case).
     */
    private maybeInitializeStartDate(): void {
        if (this.hasInitializedStartDate) return;
        if (this.readService.getTasks().length === 0) return;
        this.hasInitializedStartDate = true;
        if (!this.plugin.settings.startFromOldestOverdue) return;
        const oldestOverdue = this.findOldestOverdueDate();
        const visualToday = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        const visualPastDate = DateUtils.addDays(visualToday, -this.plugin.settings.pastDaysToShow);
        this.viewState.startDate = (oldestOverdue && oldestOverdue < visualPastDate) ? oldestOverdue : visualPastDate;
    }

    async onClose() {
        this.hoverParent.dispose();
        this.toolbar?.closeFilterPopover();
        this.sidebarFilterMenu.close();
        this.sidebarSortMenu.close();
        this.dragHandler.destroy();
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.unsubscribeDelete) {
            this.unsubscribeDelete();
        }
        this.sidebarManager.detach();
        if (this.currentTimeInterval) {
            window.clearInterval(this.currentTimeInterval);
            this.currentTimeInterval = null;
        }
        if (this.renderRafId !== null) {
            cancelAnimationFrame(this.renderRafId);
            this.renderRafId = null;
            this.renderDirty = false;
        }
    }

    getEffectiveZoomLevel(): number {
        return this.viewState.zoomLevel ?? this.plugin.settings.zoomLevel;
    }

    public refresh() {
        // Re-evaluate startDate (Today button logic) for day boundary crossing or settings change
        const visualToday = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        const visualPastDate = DateUtils.addDays(visualToday, -this.plugin.settings.pastDaysToShow);
        if (this.plugin.settings.startFromOldestOverdue) {
            const oldestOverdue = this.findOldestOverdueDate();
            this.viewState.startDate = (oldestOverdue && oldestOverdue < visualPastDate) ? oldestOverdue : visualPastDate;
        } else {
            this.viewState.startDate = visualPastDate;
        }

        this.scrollToNowOnNextRender = true;
        this.render();
    }

    // ==================== Core Rendering ====================

    /** Renders the "now" indicator line on today's column. */
    private renderCurrentTimeIndicator() {
        this.gridRenderer.renderCurrentTimeIndicator();
    }

    /** Scrolls the timeline to center the current time vertically. */
    private scrollToCurrentTime(): void {
        const scrollArea = this.container.querySelector('.timeline-scroll-area') as HTMLElement | null;
        if (!scrollArea) return;
        // Only scroll if today is visible (indicator was rendered)
        if (!this.container.querySelector('.current-time-indicator')) return;

        const now = new Date();
        const startHour = this.plugin.settings.startHour;
        let minutesFromStart = now.getHours() * 60 + now.getMinutes() - startHour * 60;
        if (minutesFromStart < 0) minutesFromStart += 1440;

        const hourHeight = 60 * this.getEffectiveZoomLevel();
        const nowPx = minutesFromStart * hourHeight / 60;
        const timeCol = scrollArea.querySelector('.time-axis-column') as HTMLElement | null;
        const gridOffset = timeCol?.offsetTop ?? 0;
        scrollArea.scrollTop = gridOffset + nowPx - scrollArea.clientHeight / 2;
    }

    /**
     * Synchronous render with scroll-save protection.
     * If a rAF scroll restore is already pending (from a prior render in this frame),
     * skip re-saving scroll — the previously saved value is still correct.
     */
    private render(): void {
        // 保留中の coalesce 済み render をキャンセル（同 frame 内で同期 render が呼ばれたら
        // 二重描画しない）
        if (this.renderRafId !== null) {
            cancelAnimationFrame(this.renderRafId);
            this.renderRafId = null;
            this.renderDirty = false;
        }
        this.saveScrollPosition();
        this.performRender();
    }

    /**
     * 同一 frame 内に複数回呼ばれても 1 回の render に集約する。
     * データ変更通知 (onChange) からの render はこの経路を使う。
     * トールバー / sidebar / pinch zoom 等の即時反映が必要な経路は render() を直呼び。
     */
    private scheduleRender(): void {
        this.renderDirty = true;
        if (this.renderRafId !== null) return;
        this.renderRafId = requestAnimationFrame(() => {
            this.renderRafId = null;
            if (!this.renderDirty) return;
            this.renderDirty = false;
            this.saveScrollPosition();
            this.performRender();
        });
    }

    private saveScrollPosition(): void {
        const scrollArea = this.container.querySelector('.timeline-scroll-area');
        const grid = scrollArea?.querySelector('.timeline-scroll-area__grid') as HTMLElement | null;
        if (scrollArea && grid) {
            // Save relative to grid offset so allday height changes don't cause drift
            this.savedScrollTop = scrollArea.scrollTop - grid.offsetTop;
        }
    }

    private getPinnedListCallbacks(): PinnedListCallbacks {
        return {
            onCollapsedChange: (listId, collapsed) => {
                if (!this.viewState.pinnedListCollapsed) this.viewState.pinnedListCollapsed = {};
                this.viewState.pinnedListCollapsed[`${COLLAPSE_KEY_PREFIX}${listId}`] = collapsed;
                this.app.workspace.requestSaveLayout();
            },
            onSortEdit: (listDef, anchorEl) => this.openPinnedListSort(listDef, anchorEl),
            onFilterEdit: (listDef, anchorEl) => this.openPinnedListFilter(listDef, anchorEl),
            onDuplicate: (listDef) => {
                const lists = this.viewState.pinnedLists!;
                const idx = lists.indexOf(listDef);
                const dup = {
                    ...listDef,
                    id: 'pl-' + Date.now(),
                    name: listDef.name + ' (copy)',
                    filterState: structuredClone(listDef.filterState),
                    sortState: listDef.sortState ? structuredClone(listDef.sortState) : undefined,
                };
                lists.splice(idx + 1, 0, dup);
                this.app.workspace.requestSaveLayout();
                this.render();
            },
            onRemove: (listDef) => {
                const lists = this.viewState.pinnedLists!;
                const idx = lists.indexOf(listDef);
                if (idx >= 0) lists.splice(idx, 1);
                this.app.workspace.requestSaveLayout();
                this.render();
            },
            onMoveUp: (listDef) => {
                const lists = this.viewState.pinnedLists!;
                const idx = lists.indexOf(listDef);
                if (idx > 0) {
                    [lists[idx - 1], lists[idx]] = [lists[idx], lists[idx - 1]];
                    this.app.workspace.requestSaveLayout();
                    this.render();
                }
            },
            onMoveDown: (listDef) => {
                const lists = this.viewState.pinnedLists!;
                const idx = lists.indexOf(listDef);
                if (idx >= 0 && idx < lists.length - 1) {
                    [lists[idx], lists[idx + 1]] = [lists[idx + 1], lists[idx]];
                    this.app.workspace.requestSaveLayout();
                    this.render();
                }
            },
            onToggleApplyViewFilter: (listDef) => {
                listDef.applyViewFilter = !listDef.applyViewFilter;
                this.app.workspace.requestSaveLayout();
                this.render();
            },
            onRename: () => {
                this.app.workspace.requestSaveLayout();
            },
        };
    }

    /**
     * Re-render only the pinned lists section.
     * Called from the partial update path so that pinnedLists reflect changes
     * to status/content/childLines (count, filter membership, sort, card body).
     */
    private refreshPinnedLists(): void {
        const sidebarBody = this.container.querySelector('.view-sidebar__body') as HTMLElement | null;
        if (!sidebarBody) return;
        this.pinnedListRenderer.render(
            sidebarBody,
            this.viewState.pinnedLists ?? [],
            this.buildCollapsedStateForRenderer(),
            this.getPinnedListCallbacks(),
            this.toolbar?.getFilterState(),
        );
    }

    /**
     * Strip the `${viewId}::` prefix so PinnedListRenderer receives a plain
     * Record<listId, boolean>. The viewState side keeps the prefix to avoid
     * timeline/calendar collapse-state collisions.
     */
    private buildCollapsedStateForRenderer(): Record<string, boolean> {
        const out: Record<string, boolean> = {};
        const stored = this.viewState.pinnedListCollapsed;
        if (!stored) return out;
        for (const [key, val] of Object.entries(stored)) {
            if (key.startsWith(COLLAPSE_KEY_PREFIX)) {
                out[key.slice(COLLAPSE_KEY_PREFIX.length)] = val;
            }
        }
        return out;
    }

    /**
     * One-shot migration: any key without `::` is assumed to be a legacy
     * listId-only entry from before viewId-namespacing was introduced.
     * Prefix it with `${viewId}::` so timeline owns it.
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

    private tryPartialUpdate(taskId: string): boolean {
        const card = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
        const dt = this.readService.getDisplayTask(taskId);
        if (!card) return false;
        if (!dt) return false;

        const contentContainer = card.querySelector('.task-card__content');
        if (contentContainer) contentContainer.remove();
        const timeEl = card.querySelector('.task-card__time');
        if (timeEl) timeEl.remove();
        const expandBar = card.querySelector('.task-card__expand-bar');
        if (expandBar) expandBar.remove();

        const isAllDay = card.classList.contains('task-card--allday');
        const opts = isAllDay ? { topRight: 'none' as const, compact: true } : undefined;
        this.taskRenderer.render(card, dt, this.plugin.settings, opts);
        TaskStyling.applyTaskColor(card, dt.color ?? null);
        TaskStyling.applyTaskLinestyle(card, dt.linestyle ?? null);
        return true;
    }

    private performRender() {
        // On narrow/mobile, force sidebar closed unless user explicitly opened it this session
        if (this.sidebarManager.isNarrow() && !this.sidebarOpenedThisSession) {
            this.viewState.showSidebar = false;
        }
        this.sidebarManager.syncPresentation(this.viewState.showSidebar, { animate: false });

        this.taskRenderer.disposeInside(this.container);
        this.container.empty();

        // Apply Zoom Level
        const zoomLevel = this.getEffectiveZoomLevel();
        this.container.style.setProperty('--hour-height', `${60 * zoomLevel}px`);

        // Measure and set actual scrollbar width for grid alignment
        const scrollbarWidth = this.measureScrollbarWidth();
        this.container.style.setProperty('--scrollbar-width-actual', `${scrollbarWidth}px`);

        // Toolbar host (top row)
        const toolbarHost = this.container.createDiv('timeline-view__toolbar-host');

        // Build sidebar layout (bottom row)
        const { main, sidebarHeader, sidebarBody } = this.sidebarManager.buildLayout(this.container);

        // Sidebar header content
        sidebarHeader.createEl('p', { cls: 'view-sidebar__title', text: t('pinnedList.pinnedLists') });

        const addListBtn = sidebarHeader.createEl('button', { cls: 'view-sidebar__add-btn' });
        setIcon(addListBtn, 'plus');
        addListBtn.appendText(t('pinnedList.addList'));
        addListBtn.addEventListener('click', () => {
            const newId = 'pl-' + Date.now();
            if (!this.viewState.pinnedLists) this.viewState.pinnedLists = [];
            this.viewState.pinnedLists.push({
                id: newId,
                name: t('pinnedList.newList'),
                filterState: createEmptyFilterState(),
            });
            this.app.workspace.requestSaveLayout();
            this.pinnedListRenderer.scheduleRename(newId);
            this.render();
        });

        const dates = this.getDatesToShow();

        // Render pinned lists into sidebar body
        this.pinnedListRenderer.render(
            sidebarBody,
            this.viewState.pinnedLists ?? [],
            this.buildCollapsedStateForRenderer(),
            this.getPinnedListCallbacks(),
            this.toolbar?.getFilterState(),
        );

        // Render Toolbar (above both columns)
        this.toolbar = new TimelineToolbar(
            toolbarHost,
            this.app,
            this.viewState,
            this.plugin,
            this.readService,
            {
                onRender: () => this.render(),
                onScrollToNow: () => {
                    this.scrollToNowOnNextRender = true;
                    this.render();
                },
                onStateChange: () => {
                    this.app.workspace.requestSaveLayout();
                },
                getDatesToShow: () => this.getDatesToShow(),
                onRequestSidebarToggle: (nextOpen) => {
                    if (nextOpen) this.sidebarOpenedThisSession = true;
                    this.viewState.showSidebar = nextOpen;
                    this.sidebarManager.applyOpen(nextOpen, { animate: true, persist: true });
                },
                getLeafPosition: () => ViewUriBuilder.detectLeafPosition(this.leaf, this.app.workspace),
                getCustomName: () => this.viewState.customName,
                onRename: (newName) => {
                    this.viewState.customName = newName;
                    this.leaf.updateHeader();
                    this.app.workspace.requestSaveLayout();
                },
                getLeaf: () => this.leaf,
            }
        );
        this.toolbar.render();

        // Use GridRenderer (render into main column)
        const filteredTasks = this.readService.getTasksForDateRange(
            dates[0], dates[dates.length - 1], this.toolbar.getFilterState()
        );
        this.gridRenderer.render(
            main,
            this.allDayRenderer,
            this.timelineRenderer,
            this.habitRenderer,
            this.handleManager,
            dates,
            filteredTasks,
        );

        this.renderCurrentTimeIndicator();

        // Restore scroll position synchronously to avoid 1-frame "scroll-to-top" flicker.
        // offsetTop の読み取り自体が forced reflow を誘発し layout が確定するので
        // rAF 経由は不要。
        const newScrollArea = this.container.querySelector('.timeline-scroll-area') as HTMLElement | null;
        if (newScrollArea) {
            if (this.scrollToNowOnNextRender) {
                this.scrollToNowOnNextRender = false;
                this.scrollToCurrentTime();
            } else if (this.savedScrollTop !== null) {
                const newGrid = newScrollArea.querySelector('.timeline-scroll-area__grid') as HTMLElement | null;
                const gridOffset = newGrid?.offsetTop ?? 0;
                newScrollArea.scrollTop = gridOffset + this.savedScrollTop;
            }
        }

        // Attach handles to the selected card after scroll restoration.
        // Section renderers already tagged cards with `.selected` during render;
        // reapplySelectionClass is idempotent and ensures handles are attached
        // and z-index is raised on the fresh DOM.
        // 同期実行することで、最初の paint からハンドル + SELECTED_Z_INDEX が
        // 揃った状態で表示され、cascade z-index に一瞬戻る/ハンドルが 1 frame 消える
        // ちらつきを防ぐ。
        if (this.handleManager.getSelectedTaskId()) {
            this.handleManager.reapplySelectionClass();
        }

        // Dev invariant: timeline 主域内に同一 data-id のカードが複数存在しないこと。
        // 同 id 重複は section dispatch のドリフトを示す致命的不整合のサイン。
        // production ビルドでは esbuild の define で __DEV__=false が dead-code 化される。
        if (__DEV__) {
            this.assertNoDuplicateCardIds();
        }
    }

    private assertNoDuplicateCardIds(): void {
        const main = this.container.querySelector('.view-sidebar-main') ?? this.container;
        const counts = new Map<string, number>();
        main.querySelectorAll<HTMLElement>('.task-card[data-id]').forEach(el => {
            const id = el.dataset.id;
            if (!id) return;
            counts.set(id, (counts.get(id) ?? 0) + 1);
        });
        for (const [id, n] of counts) {
            if (n > 1) {
                console.error('[render-invariant] duplicate task-card data-id', { id, count: n });
            }
        }
    }

    /**
     * Measures the actual scrollbar width for the current environment.
     * Returns 0 for overlay scrollbars (iOS/macOS), ~15px for classic scrollbars (Windows).
     */
    private measureScrollbarWidth(): number {
        const outer = document.createElement('div');
        outer.style.visibility = 'hidden';
        outer.style.overflow = 'scroll';
        outer.style.width = '100px';
        outer.style.height = '100px';
        outer.style.position = 'absolute';
        outer.style.top = '-9999px';
        document.body.appendChild(outer);

        const inner = document.createElement('div');
        inner.style.width = '100%';
        outer.appendChild(inner);

        const scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
        document.body.removeChild(outer);

        return scrollbarWidth;
    }

    private getTouchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private openPinnedListSort(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sidebarSortMenu.setSortState(listDef.sortState ?? createEmptySortState());
        this.sidebarSortMenu.showMenuAtElement(anchorEl, {
            onSortChange: () => {
                listDef.sortState = this.sidebarSortMenu.getSortState();
                this.app.workspace.requestSaveLayout();
                this.render();
            },
        });
    }

    private openPinnedListFilter(listDef: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sidebarFilterMenu.setFilterState(listDef.filterState);
        this.sidebarFilterMenu.showMenuAtElement(anchorEl, {
            onFilterChange: () => {
                listDef.filterState = this.sidebarFilterMenu.getFilterState();
                this.app.workspace.requestSaveLayout();
                this.render();
            },
            getTasks: () => this.readService.getTasks(),
            getStartHour: () => this.plugin.settings.startHour,
        });
    }

    // ==================== Grid & Layout ====================



    private getDatesToShow(): string[] {
        const dates = [];
        for (let i = 0; i < this.viewState.daysToShow; i++) {
            dates.push(DateUtils.addDays(this.viewState.startDate, i));
        }
        return dates;
    }



    // ==================== Color & Styling ====================




    // ==================== Task Creation ====================

    // ==================== Overdue Date Logic ====================

    /**
     * Finds the oldest date with incomplete overdue tasks.
     * Returns null if all past tasks are completed.
     * Used for initial view date on open/reload.
     */
    private findOldestOverdueDate(): string | null {
        const startHour = this.plugin.settings.startHour;
        const visualToday = DateUtils.getVisualDateOfNow(startHour);
        const filterState = this.viewState.filterState ?? createEmptyFilterState();
        const displayTasks = this.readService.getFilteredTasks(filterState);

        return findOldestOverdueDate(displayTasks, visualToday, this.plugin.settings.statusDefinitions);
    }
}
