import { ItemView, WorkspaceLeaf, setIcon, type Workspace, type ViewStateResult } from 'obsidian';
import { t } from '../../i18n';
import { ViewUriBuilder } from '../sharedLogic/ViewUriBuilder';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { Task, ViewState, PinnedListDefinition } from '../../types';
import { findOldestOverdueDate } from '../../services/display/OverdueTaskFinder';
import { DragHandler } from '../../interaction/drag/DragHandler';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { createTaskHubOpener } from '../../modals/hub/openTaskHub';
import type { TaskHubPanelOptions } from '../../modals/hub/TaskHubPanel';
import { logDebug, logError } from '../../log/log';

import { DateUtils } from '../../utils/DateUtils';
import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskWriteService } from '../../services/data/TaskWriteService';
import { ChildLineMenuBuilder } from '../../interaction/menu/builders/ChildLineMenuBuilder';

import TaskViewerPlugin from '../../main';
import { MOBILE_BREAKPOINT_PX } from '../../constants/layout';

import { HandleManager } from './HandleManager';
import { SelectionController } from '../../interaction/selection/SelectionController';
import { TimelineToolbar } from './TimelineToolbar';
import { TaskIdGenerator } from '../../services/display/TaskIdGenerator';

import { GridRenderer } from './renderers/GridRenderer';
import { AllDaySectionRenderer } from '../sharedUI/AllDaySectionRenderer';
import { DateHeaderRenderer } from '../sharedUI/DateHeaderRenderer';
import { PeriodicHeaderRenderer } from '../sharedUI/PeriodicHeaderRenderer';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TimelineSectionRenderer } from './renderers/TimelineSectionRenderer';
import { PinnedListRenderer, type PinnedListCallbacks } from '../sharedUI/PinnedListRenderer';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { TopRightConfigEditor } from '../customMenus/TopRightConfigEditor';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { createEmptyFilterState } from '../../services/filter/FilterTypes';
import { createEmptySortState } from '../../services/sort/SortTypes';
import { MoonPhaseRenderer } from '../sharedUI/MoonPhaseRenderer';
import { SidebarManager } from '../sidebar/SidebarManager';
import { openTaskInEditor } from '../sharedLogic/NavigationUtils';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { VIEW_META_TIMELINE } from '../../constants/viewRegistry';
import { RenderScheduler } from '../sharedUI/RenderScheduler';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { codecFor } from '../../services/viewConfig';
import { TimelineSchema, type TimelineConfig, type TimelineTransient } from './TimelineSchema';
import type { ViewConfigCodec } from '../../services/viewConfig';

export const VIEW_TYPE_TIMELINE = VIEW_META_TIMELINE.type;

/**
 * View id used as a namespace prefix for shared viewState fields whose keys
 * collide between views (e.g. pinnedListCollapsed). Lets timeline and calendar
 * own independent collapse state for the same listId.
 */
const VIEW_ID = 'timeline';
const COLLAPSE_KEY_PREFIX = `${VIEW_ID}::`;

/**
 * Timeline View - Displays tasks on a time-based grid layout.
 *
 * Persisted state shape is declared in TimelineSchema (config + transient).
 * This view-local type alias is the union seen by setState — Obsidian gives
 * us `unknown`-shaped dicts so the codec is what actually parses them.
 */
type TimelineViewState = Partial<TimelineConfig> & Partial<TimelineTransient>;

export class TimelineView extends ItemView {
    // ==================== Services & Handlers ====================
    private readService: TaskReadService;
    private writeService: TaskWriteService;
    private plugin: TaskViewerPlugin;
    private taskRenderer: TaskCardRenderer;
    private dragHandler: DragHandler;
    private menuHandler: MenuHandler;
    private handleManager: HandleManager;
    private selectionController!: SelectionController;
    private toolbar: TimelineToolbar | undefined;
    private sidebarManager: SidebarManager;

    // ==================== Renderers ====================
    private gridRenderer: GridRenderer;
    private allDayRenderer: AllDaySectionRenderer;
    private timelineRenderer: TimelineSectionRenderer;
    private pinnedListRenderer: PinnedListRenderer;
    private sidebarFilterMenu = new FilterMenuComponent();
    private sidebarSortMenu = new SortMenuComponent();
    private topRightEditor = new TopRightConfigEditor();
    private moonRenderer: MoonPhaseRenderer;
    private dateHeaderRenderer: DateHeaderRenderer;
    private periodicHeaderRenderer: PeriodicHeaderRenderer;
    private linkInteractionManager: TaskLinkInteractionManager;

    // ==================== State ====================
    private container: HTMLElement;
    /**
     * Stable host for PinnedListRenderer that survives container.empty() —
     * detached before each empty() and re-appended into sidebarBody after the
     * sidebar layout is rebuilt. This preserves PinnedList's DOM (paging
     * pages, expanded body content) and its onChange subscription across
     * full view renders.
     */
    private pinnedHost: HTMLElement;
    private viewState: ViewState;
    private unsubscribe: (() => void) | null = null;
    private unsubscribeDelete: (() => void) | null = null;
    private currentTimeInterval: number | null = null;
    // Scroll save/restore: save the visible time at the viewport top as
    // minutes from 00:00 and restore by recomputing scrollTop from current
    // --hour-height. Robust against zoom changes and async layout settle.
    // Three-pass rAF (sync + 2× rAF) absorbs residual transients.
    private savedScrollAnchor: { minutesFromTop: number } | null = null;
    private scrollToNowOnNextRender = false;
    private stickyAnchorObserver: ResizeObserver | null = null;

    /**
     * Init barrier: viewState-dependent initialization (e.g. computing the
     * initial startDate from filterState) must wait for **all** of:
     *   - DOM ready (onOpen completed)
     *   - state applied (setState completed — even when no state was passed,
     *     Obsidian still calls setState once with empty state)
     *   - tasks loaded (readService has data — either cached at open time or
     *     delivered later via onChange)
     *
     * Without this barrier, onOpen running before setState would compute the
     * initial date with an empty filter (URI-restored filterState arrives in
     * setState which fires after onOpen for fresh views), pinning the view to
     * a filtered-out overdue task. The classic "init once" latch pattern was
     * the bug.
     *
     * Add new viewState-dependent init to runInitialStateLogic() — never to
     * onOpen directly — to stay race-free regardless of Obsidian's lifecycle
     * order.
     */
    private initBarrier = {
        domReady: false,
        stateApplied: false,
    };
    private hasRunInitialLogic = false;

    // Render coalescing (frame-level): 同一 frame 内に複数の onChange が来ても render は 1 回
    // 実装は RenderScheduler に委譲。
    private renderScheduler: RenderScheduler;

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
        this.taskRenderer = new TaskCardRenderer(this.app, this.readService, this.writeService, this.plugin.menuPresenter, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.hoverParent,
        }, () => this.plugin.settings, () => this.viewState.maskMode ?? false);
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

    private get codec(): ViewConfigCodec<TimelineConfig, TimelineTransient> {
        return codecFor(VIEW_TYPE_TIMELINE) as ViewConfigCodec<TimelineConfig, TimelineTransient>;
    }

    async setState(state: TimelineViewState, result: ViewStateResult): Promise<void> {
        const stateDict = (state ?? {}) as Record<string, unknown>;
        const config = this.codec.parseConfig(stateDict);
        const transient = this.codec.parseTransient(stateDict);

        // Apply config with REPLACE semantics over schema defaults — fields
        // absent from `state` are restored to their declared defaults rather
        // than retained. This is the single behavior that closes B5 across
        // all views (no per-view "else undefined" branches needed).
        const next: Partial<TimelineConfig> = { ...TimelineSchema.defaults, ...config };
        Object.assign(this.viewState, next);

        // Transient is overlaid additively (no defaults — these are per-leaf).
        Object.assign(this.viewState, transient);

        // Side effect: sidebar DOM has to follow the boolean.
        this.sidebarManager.applyOpen(this.viewState.showSidebar ?? true, { animate: false });

        await super.setState(state, result);
        // State-side of the init barrier is now satisfied. If onOpen has
        // already run and tasks are loaded, this fires initial state-
        // dependent logic (e.g. computing startDate from the restored
        // filterState); otherwise it waits.
        this.initBarrier.stateApplied = true;
        this.tryRunInitialStateLogic();
        this.render();
        // setState may have changed filterState / pinnedLists / collapse — none
        // of these go through readService.onChange, so PinnedList wouldn't
        // otherwise refresh. (Safe to call even before attach: refresh() no-ops
        // when not attached.)
        this.pinnedListRenderer?.refresh();
    }

    getState(): Record<string, unknown> {
        const config = this.viewState as Partial<TimelineConfig>;
        const transient = this.viewState as Partial<TimelineTransient>;
        return {
            ...this.codec.serializeConfig(config),
            ...this.codec.serializeTransient(transient),
        };
    }

    async onOpen() {
        logDebug(`[${this.getViewType()}] opened`);
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
        this.taskRenderer.setChildLineEditCallback((parentTask, line, bodyLine, x, y) => {
            childLineMenuBuilder.showMenu(parentTask, line, bodyLine, x, y);
        });
        this.taskRenderer.setDetailCallback((task) => this.openTaskHub(task));
        this.taskRenderer.setContextMenuCallback((task, x, y) => this.menuHandler.showTaskContextMenu(task, x, y));
        this.taskRenderer.setOpenInEditorCallback((task) => openTaskInEditor(this.app, task, this.plugin.settings.reuseExistingTab));
        this.taskRenderer.setDoubleTapActionGetter(() => this.plugin.settings.doubleTapAction);
        this.menuHandler.setTaskHubOpener((taskId, opts) => {
            const task = this.readService.getTask(taskId);
            if (task) this.openTaskHub(task, opts);
        });

        // Initialize HandleManager
        this.handleManager = new HandleManager(this.container, {
            getTask: (id) => this.readService.getTask(id),
            getStartHour: () => this.plugin.settings.startHour,
        });
        this.selectionController = new SelectionController(this.handleManager);

        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);

        // Construct the toolbar once for the lifetime of this view. performRender()
        // calls toolbar.detach() before container.empty() and toolbar.mount(host)
        // after, so the underlying DOM + filterMenu instance survive renders. This
        // is what lets the filter popover stay open across data-driven re-renders.
        this.toolbar = new TimelineToolbar(
            this.app,
            this.viewState,
            this.plugin,
            this.readService,
            {
                onRender: () => {
                    this.render();
                    // Toolbar filter changes can affect pinned lists with
                    // applyViewFilter:true; PinnedList does not see view filter
                    // state via onChange, so refresh explicitly here.
                    this.pinnedListRenderer?.refresh();
                },
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
                linkInteractionManager: this.linkInteractionManager,
                hoverParent: this.hoverParent,
            }
        );

        // Initialize Renderers
        this.allDayRenderer = new AllDaySectionRenderer(this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.viewState.daysToShow, VIEW_ID);
        this.timelineRenderer = new TimelineSectionRenderer(this.plugin, this.menuHandler, this.handleManager, this.taskRenderer, () => this.getEffectiveZoomLevel(), VIEW_ID);
        this.dateHeaderRenderer = new DateHeaderRenderer({
            app: this.app,
            plugin: this.plugin,
            hoverParent: this.hoverParent,
            linkInteractionManager: this.linkInteractionManager,
        });
        this.periodicHeaderRenderer = new PeriodicHeaderRenderer({
            app: this.app,
            plugin: this.plugin,
            hoverParent: this.hoverParent,
            linkInteractionManager: this.linkInteractionManager,
        });
        this.gridRenderer = new GridRenderer(
            this.container,
            this.viewState,
            this.plugin,
            this.menuHandler,
            this.hoverParent,
            this.dateHeaderRenderer,
            this.periodicHeaderRenderer,
        );
        this.pinnedListRenderer = new PinnedListRenderer(this.taskRenderer, this.plugin, this.menuHandler, this.readService);
        // Persistent host for pinned lists. Lives outside the empty() target
        // (we explicitly detach it before container.empty() in performRender,
        // then reparent into the freshly-built sidebarBody).
        this.pinnedHost = document.createElement('div');
        this.pinnedListRenderer.attach({
            host: this.pinnedHost,
            getLists: () => this.viewState.pinnedLists ?? [],
            getCollapsed: () => this.buildCollapsedStateForRenderer(),
            getViewFilterState: () => this.toolbar?.getFilterState(),
            callbacks: this.getPinnedListCallbacks(),
            viewId: VIEW_ID,
        });
        this.moonRenderer = new MoonPhaseRenderer();
        this.sidebarFilterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.sidebarFilterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.sidebarFilterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);

        // Initialize DragHandler with selection callback, move callback, and view start date provider
        this.dragHandler = new DragHandler(this.container, this.readService, this.writeService, this.plugin,
            this.selectionController,
            (taskId: string) => {
                // Store base task id so split segments all share one selection and
                // the selection survives a drag-move that regenerates segment ids.
                const segInfo = TaskIdGenerator.parseSegmentId(taskId);
                const baseId = segInfo?.baseId ?? taskId;
                this.handleManager.selectTask(baseId);
            },
            () => { /* no-op: handles are inside task cards */ },
            () => this.viewState.startDate,
            () => DateUtils.addDays(this.viewState.startDate, this.viewState.daysToShow - 1),
            () => this.getEffectiveZoomLevel()
        );

        // Background click → deselect、UI 経由 delete → deselect。両方 SelectionController に集約。
        // External-editor deletions are not tracked here by design — if that
        // case causes a visual glitch (line-shifted task inherits `.is-selected`),
        // user can click to re-select.
        this.selectionController.attachBackgroundClick(this.container);
        this.unsubscribeDelete = this.selectionController.attachDeleteListener(this.writeService);

        // Initialize render dispatch controller (rAF coalesce only — partial
        // update was retired in favour of keyed reconciliation in performRender).
        this.renderScheduler = new RenderScheduler({
            performFull: () => {
                this.saveScrollPosition();
                this.performRender();
            },
        });

        // Subscribe to data changes
        this.unsubscribe = this.readService.onChange((taskId, changes) => {
            // First task delivery is one of the gates for initial state setup
            // (DOM + state + tasks). No auto-scroll here: user-driven scroll
            // only via Now button / refresh / onOpen.
            this.tryRunInitialStateLogic();
            this.renderScheduler.handleChange(taskId, changes);
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
            const scrollArea = this.container.querySelector('.timeline-grid') as HTMLElement | null;
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
            const scrollArea = this.container.querySelector('.timeline-grid') as HTMLElement | null;
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
            const scrollArea = this.container.querySelector('.timeline-grid') as HTMLElement | null;
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

        // DOM-side of the init barrier is now satisfied. If state has already
        // been applied and tasks are cached, this fires the initial logic
        // immediately; otherwise it waits for the missing gate.
        this.initBarrier.domReady = true;
        this.tryRunInitialStateLogic();

        this.stickyAnchorObserver = new ResizeObserver(() => {
            this.updateStickyHeaderTops();
        });

        // Initial render — scroll to current time
        this.scrollToNowOnNextRender = true;
        this.render();
    }

    /**
     * Init-barrier coordinator. Runs viewState-dependent initialization exactly
     * once, after DOM ready + state applied + tasks loaded — in whatever order
     * those gates fire. See `initBarrier` field comment for rationale.
     *
     * Add new viewState-dependent init steps inside this method.
     */
    private tryRunInitialStateLogic(): void {
        if (this.hasRunInitialLogic) return;
        if (!this.initBarrier.domReady) return;
        if (!this.initBarrier.stateApplied) return;
        if (this.readService.getTasks().length === 0) return;
        this.hasRunInitialLogic = true;

        this.initializeStartDate();
        // Future viewState-dependent init goes here.
    }

    /**
     * タスクハブモーダルを開く共通エントリ (dblclick / menu 経由)。
     * modal が出た時点で card の選択状態は不要なので解除する。
     *
     * `selectTask(null)` は handle DOM ごと除去する破壊的操作なので、トリガと
     * なった pointerdown の touch sequence が **完全に終わってから** 走らせる。
     * pointerdown handler 内で同期に呼ぶと、元 touch target (handle 内 SVG path)
     * が detached → 後続 pointerup/click が `.modal-bg` にリターゲットされ、
     * Obsidian Modal の outside-click で modal が即閉じる (Android Chromium で
     * 観測。CDP 実機トレース確認済み)。`setTimeout(0)` の macrotask 境界で
     * touchend / pointerup / click の dispatch をすべて消化させてから DOM を
     * 触る。modal は selection ring を視覚的に覆い隠すので、close 後に ring が
     * 残らないという元 commit (7c43222) の意図はそのまま満たされる。
     */
    private openTaskHub(task: Task, options?: TaskHubPanelOptions): void {
        createTaskHubOpener(this.app, {
            taskRenderer: this.taskRenderer,
            menuHandler: this.menuHandler,
            readService: this.readService,
            writeService: this.writeService,
            plugin: this.plugin,
        }, () => setTimeout(() => this.handleManager.selectTask(null), 0))(task, options);
    }

    /**
     * Compute the initial startDate from the restored filterState + tasks +
     * settings. Called once via the init barrier.
     */
    private initializeStartDate(): void {
        if (!this.plugin.settings.startFromOldestOverdue) return;
        const oldestOverdue = this.findOldestOverdueDate();
        const visualToday = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        const visualPastDate = DateUtils.addDays(visualToday, -this.plugin.settings.pastDaysToShow);
        this.viewState.startDate = (oldestOverdue && oldestOverdue < visualPastDate) ? oldestOverdue : visualPastDate;
    }

    async onClose() {
        logDebug(`[${this.getViewType()}] closed`);
        this.hoverParent.dispose();
        this.toolbar?.closeFilterPopover();
        this.sidebarFilterMenu.close();
        this.sidebarSortMenu.close();
        this.dragHandler.destroy();
        this.pinnedListRenderer?.detach();
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
        if (this.stickyAnchorObserver) {
            this.stickyAnchorObserver.disconnect();
            this.stickyAnchorObserver = null;
        }
        this.dateHeaderRenderer?.dispose();
        this.renderScheduler?.dispose();
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

    /** Scrolls so that the current-time indicator sits at viewport vertical
     *  center. Delegates the center calculation to the browser via
     *  `Element.scrollIntoView({ block: 'center' })` so that JS never reads a
     *  transient `clientHeight` mid-render — the browser uses the fully
     *  resolved layout each time it executes the call. To absorb post-render
     *  settle (allday/header height), the caller invokes this across
     *  two `requestAnimationFrame` ticks ("last write wins"). */
    private scrollToCurrentTime(): void {
        const scrollArea = this.container.querySelector('.timeline-grid') as HTMLElement | null;
        if (!scrollArea) return;
        if (!scrollArea.querySelector('.timeline-scroll-area__axis')) return;
        const indicator = scrollArea.querySelector('.current-time-indicator') as HTMLElement | null;
        if (!indicator) return;
        indicator.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
    }

    /**
     * Synchronous render with scroll-save protection.
     * If a rAF scroll restore is already pending (from a prior render in this frame),
     * skip re-saving scroll — the previously saved value is still correct.
     */
    private render(): void {
        // 保留中の coalesce 済み render をキャンセル（同 frame 内で同期 render が呼ばれたら
        // 二重描画しない）
        this.renderScheduler?.cancelPending();
        this.saveScrollPosition();
        this.performRender();
    }

    /**
     * 同一 frame 内に複数回呼ばれても 1 回の render に集約する。
     * データ変更通知 (onChange) からの render はこの経路を使う。
     * トールバー / sidebar / pinch zoom 等の即時反映が必要な経路は render() を直呼び。
     */
    private scheduleRender(): void {
        this.renderScheduler.scheduleRender();
    }

    private saveScrollPosition(): void {
        const grid = this.container.querySelector('.timeline-grid') as HTMLElement | null;
        if (!grid) return;
        const hourHeight = this.readHourHeightPx(grid);
        if (hourHeight <= 0) return;
        this.savedScrollAnchor = {
            minutesFromTop: grid.scrollTop / hourHeight * 60,
        };
    }

    /** Restore the saved viewport-top time by computing scrollTop from
     *  current --hour-height. Idempotent on stable layout; safe to call
     *  multiple times across rAF passes. */
    private applyScrollAnchor(): void {
        const grid = this.container.querySelector('.timeline-grid') as HTMLElement | null;
        if (!grid || !this.savedScrollAnchor) return;
        const hourHeight = this.readHourHeightPx(grid);
        if (hourHeight <= 0) return;
        grid.scrollTop = this.savedScrollAnchor.minutesFromTop / 60 * hourHeight;
    }

    /** Read the resolved --hour-height in px from the scroll container.
     *  Falls back to 60 (the design default) if the variable is missing. */
    private readHourHeightPx(grid: HTMLElement): number {
        const raw = getComputedStyle(grid).getPropertyValue('--hour-height').trim();
        const v = parseFloat(raw);
        return Number.isFinite(v) && v > 0 ? v : 60;
    }

    private updateStickyHeaderTops(): void {
        const grid = this.container.querySelector('.timeline-grid') as HTMLElement | null;
        if (!grid) return;
        const periodic = grid.querySelector('.periodic-header') as HTMLElement | null;
        const dateHeader = grid.querySelector('.date-header') as HTMLElement | null;
        const periodicH = periodic?.offsetHeight ?? 0;
        const dateH = dateHeader?.offsetHeight ?? 0;
        grid.style.setProperty('--periodic-header-sticky-top', `0px`);
        grid.style.setProperty('--date-header-sticky-top', `${periodicH}px`);
        grid.style.setProperty('--moon-section-sticky-top', `${periodicH + dateH}px`);
    }

    private rebindStickyAnchorObserver(): void {
        if (!this.stickyAnchorObserver) return;
        const grid = this.container.querySelector('.timeline-grid') as HTMLElement | null;
        if (!grid) return;
        const periodic = grid.querySelector('.periodic-header') as HTMLElement | null;
        const dateHeader = grid.querySelector('.date-header') as HTMLElement | null;
        this.stickyAnchorObserver.disconnect();
        if (periodic) this.stickyAnchorObserver.observe(periodic);
        if (dateHeader) this.stickyAnchorObserver.observe(dateHeader);
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
                this.pinnedListRenderer.refresh();
            },
            onRemove: (listDef) => {
                const lists = this.viewState.pinnedLists!;
                const idx = lists.indexOf(listDef);
                if (idx >= 0) lists.splice(idx, 1);
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
            onMoveUp: (listDef) => {
                const lists = this.viewState.pinnedLists!;
                const idx = lists.indexOf(listDef);
                if (idx > 0) {
                    [lists[idx - 1], lists[idx]] = [lists[idx], lists[idx - 1]];
                    this.app.workspace.requestSaveLayout();
                    this.pinnedListRenderer.refresh();
                }
            },
            onMoveDown: (listDef) => {
                const lists = this.viewState.pinnedLists!;
                const idx = lists.indexOf(listDef);
                if (idx >= 0 && idx < lists.length - 1) {
                    [lists[idx], lists[idx + 1]] = [lists[idx + 1], lists[idx]];
                    this.app.workspace.requestSaveLayout();
                    this.pinnedListRenderer.refresh();
                }
            },
            onToggleApplyViewFilter: (listDef) => {
                listDef.applyViewFilter = !listDef.applyViewFilter;
                this.app.workspace.requestSaveLayout();
                this.pinnedListRenderer.refresh();
            },
            onRename: () => {
                this.app.workspace.requestSaveLayout();
            },
            onTopRightEdit: (listDef, anchorEl) => {
                const tasks = this.readService.getTasks();
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

    private performRender() {
        // On narrow/mobile, force sidebar closed unless user explicitly opened it this session
        if (this.sidebarManager.isNarrow() && !this.sidebarOpenedThisSession) {
            this.viewState.showSidebar = false;
        }
        this.sidebarManager.syncPresentation(this.viewState.showSidebar, { animate: false });

        // Detach the toolbar before empty() so its DOM (and the FilterMenuComponent
        // bound to it) survives. We re-attach it via mount() below.
        this.toolbar?.detach();
        // Detach the persistent pinnedHost so its DOM (and PinnedListRenderer's
        // internal subscription / paging / collapse state) survives the empty().
        // Re-appended into the freshly-built sidebarBody below.
        // IMPORTANT: must run before our `reconciler.detach(this.container)` —
        // otherwise the timeline reconciler scoops up the pinned-list cards
        // (they live inside `this.container` until detached here), classifies
        // them as stale, and disposes them. The PinnedListRenderer never gets
        // told its DOM was emptied and only the show-more button stays in the
        // body.
        if (this.pinnedHost?.parentElement) {
            this.pinnedHost.parentElement.removeChild(this.pinnedHost);
        }

        // Keyed reconciliation: lift surviving cards into a key→element map
        // before tearing down the scaffolding. Cards retain their inner DOM /
        // markdown / Component lifecycle, and will be re-parented + re-decorated
        // when their key turns up in the new render. Stale survivors are
        // disposed at the end.
        const reconciler = new CardReconciler();
        reconciler.detach(this.container);

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
        sidebarHeader.createEl('p', { cls: 'tv-sidebar__panel-title', text: t('pinnedList.pinnedLists') });

        const addListBtn = sidebarHeader.createEl('button', { cls: 'tv-sidebar__panel-add-btn' });
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
            this.pinnedListRenderer.refresh();
        });

        const dates = this.getDatesToShow();

        // Re-attach the persistent pinned host into the freshly-built sidebar body.
        // PinnedListRenderer manages its own contents via its onChange subscription
        // and explicit refresh() calls (toolbar filter changes, list mutations) —
        // we only relocate the host here. Avoid an unconditional refresh so a
        // single onChange does not rebuild pinned DOM twice (PinnedList's own
        // subscription already handled it before this performRender ran).
        sidebarBody.appendChild(this.pinnedHost);

        // Mount the persistent toolbar instance into this render's toolbarHost.
        // First call builds DOM; subsequent calls re-attach the existing rootEl.
        this.toolbar!.mount(toolbarHost);

        // Use GridRenderer (render into main column)
        const filteredTasks = this.readService.getTasksForDateRange(
            dates[0], dates[dates.length - 1], this.toolbar!.getFilterState()
        );
        this.gridRenderer.render(
            main,
            this.allDayRenderer,
            this.timelineRenderer,
            this.moonRenderer,
            this.handleManager,
            dates,
            filteredTasks,
            reconciler,
        );

        // Dispose any cards that did not turn up in the new render (filter
        // dropped, segments collapsed, etc). Their elements are already
        // detached from the DOM by reconciler.detach().
        reconciler.forEachStale(card => this.taskRenderer.dispose(card));

        this.renderCurrentTimeIndicator();

        this.updateStickyHeaderTops();
        this.rebindStickyAnchorObserver();

        // Restore scroll position with a sync write (avoids 1-frame flicker
        // on first paint) followed by two rAF re-applies (absorbs any
        // residual async layout settle, e.g. data-driven layout flux that
        // may slip past the TaskCardRenderer expand-bar fix). Mirrors the
        // scrollToCurrentTime three-pass pattern from 4029ac9 / 7c44468.
        const newGrid = this.container.querySelector('.timeline-grid') as HTMLElement | null;
        if (newGrid) {
            if (this.scrollToNowOnNextRender) {
                this.scrollToNowOnNextRender = false;
                this.scrollToCurrentTime();
                requestAnimationFrame(() => {
                    this.scrollToCurrentTime();
                    requestAnimationFrame(() => this.scrollToCurrentTime());
                });
            } else if (this.savedScrollAnchor !== null) {
                this.applyScrollAnchor();
                requestAnimationFrame(() => {
                    this.applyScrollAnchor();
                    requestAnimationFrame(() => this.applyScrollAnchor());
                });
            }
        }

        // Attach handles to the selected card after scroll restoration.
        // Section renderers already tagged cards with `.is-selected` during render;
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
        const main = this.container.querySelector('.tv-sidebar__main') ?? this.container;
        const counts = new Map<string, number>();
        main.querySelectorAll<HTMLElement>('.task-card[data-id]').forEach(el => {
            const id = el.dataset.id;
            if (!id) return;
            counts.set(id, (counts.get(id) ?? 0) + 1);
        });
        for (const [id, n] of counts) {
            if (n > 1) {
                logError(`[render-invariant] duplicate task-card data-id: id=${id}, count=${n}`);
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
