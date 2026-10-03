import type { WorkspaceLeaf } from 'obsidian';
import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { createCardRendering } from '../sharedUI/CardRendering';
import { findOldestOverdueDate } from '../../services/display/OverdueTaskFinder';
import { DragHandler } from '../../interaction/drag/DragHandler';
import type { MenuHandler } from '../../interaction/menu/MenuHandler';

import type { TaskReadService } from '../../services/data/TaskReadService';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';

import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { MOBILE_BREAKPOINT_PX } from '../../constants/layout';

import { HandleManager } from '../sharedUI/handles/HandleManager';
import { SelectionController } from '../../interaction/selection/SelectionController';
import { TimelineToolbar } from './TimelineToolbar';
import { parseSegmentId } from '../../services/display/SegmentIds';

import { GridRenderer } from './renderers/GridRenderer';
import { AllDaySectionRenderer } from '../sharedUI/AllDaySectionRenderer';
import { DateHeaderRenderer } from '../sharedUI/DateHeaderRenderer';
import { PeriodicHeaderRenderer } from '../sharedUI/PeriodicHeaderRenderer';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TimelineSectionRenderer } from './renderers/TimelineSectionRenderer';
import { PinnedListPanel } from '../sharedUI/PinnedListPanel';
import { createEmptyFilterState } from '../../services/filter/FilterTypes';
import { MoonPhaseRenderer } from '../sharedUI/MoonPhaseRenderer';
import { SidebarManager } from '../sidebar/SidebarManager';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { HostFrameScheduler } from '../../utils/HostWindow';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { TaskViewerView } from '../base/TaskViewerView';
import { TimelineCodec, daysToShowOf, effectiveZoom, type TimelineConfig, type TimelineState, type TimelineTransient } from './TimelineSchema';
import { TimelineDays, windowDates, windowEnd, type DayWindow } from './TimelineDays';



/**
 * Timeline View - Displays tasks on a time-based grid layout.
 *
 * Its state is TimelineSchema's config and transient fields, held in the
 * base's store. The days it draws are read from the day it looks at
 * (`date`, absent while it follows today) by `TimelineDays`.
 */
export class TimelineView extends TaskViewerView<TimelineConfig, TimelineTransient> {
    // ==================== Services & Handlers ====================
    private readService: TaskReadService;
    /** The index's copies and changes (`PluginContext.getIndex`). */
    private readonly index: IndexReads;
    private operations: Operations;
    private taskRenderer: TaskCardRenderer;
    private dragHandler: DragHandler;
    private menuHandler: MenuHandler;
    private handleManager: HandleManager;
    private selectionController!: SelectionController;
    private toolbar: TimelineToolbar | undefined;
    private sidebarManager: SidebarManager;
    private readonly days: TimelineDays;

    // ==================== Renderers ====================
    private gridRenderer: GridRenderer;
    private allDayRenderer: AllDaySectionRenderer;
    private timelineRenderer: TimelineSectionRenderer;
    /** The sidebar's pinned lists; they draw themselves, and outlive the view's draws. */
    private readonly pinnedLists: PinnedListPanel;
    private moonRenderer: MoonPhaseRenderer;
    private dateHeaderRenderer: DateHeaderRenderer;
    private periodicHeaderRenderer: PeriodicHeaderRenderer;
    private linkInteractionManager: TaskLinkInteractionManager;

    // ==================== DOM ====================
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private unsubscribeDelete: (() => void) | null = null;
    // Scroll save/restore: save the visible time at the viewport top as
    // minutes from 00:00 and restore by recomputing scrollTop from current
    // --hour-height. Robust against zoom changes and async layout settle.
    // Three-pass rAF (sync + 2× rAF) absorbs residual transients.
    private savedScrollAnchor: { minutesFromTop: number } | null = null;
    private scrollToNowOnNextRender = false;
    private stickyAnchorObserver: ResizeObserver | null = null;

    /**
     * The overdue pull is first read once the view is open, has its state
     * and has tasks — in whatever order those come. The base answers the
     * first two (`onReady`); the tasks come with the index's first change
     * when they were not there at open.
     *
     * Read before the state came, the pull would be taken with an empty
     * filter (a URI's filter arrives in setState, after onOpen) and land on a
     * task the filter drops.
     */
    private stateReady = false;
    private hasPulled = false;

    /** render 後の多段 scroll 再適用用。container の window に束ねる（popout 対応）。 */
    private readonly frames = new HostFrameScheduler(() => this.container);

    // ==================== Pinch zoom state ====================
    private pinchInitialDistance: number = 0;
    private pinchInitialZoom: number = 1;
    private pinchInitialMidY: number = 0;
    private pinchInitialScrollTop: number = 0;
    private isPinching: boolean = false;
    /**
     * At narrow width the sidebar starts closed whatever the state says, and
     * only the toggle button opens it. `showSidebar` states the desktop-width
     * position; applying a config never marks the sidebar as user-opened.
     */
    private sidebarOpenedThisSession = false;
    private readonly hoverParent = new TaskViewHoverParent();

    // ==================== Lifecycle ====================

    getViewType(): string {
        return TimelineCodec.schema.viewType;
    }

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext & TimerHost) {
        super(leaf, plugin, TimelineCodec);
        this.readService = plugin.getTaskReadService();
        this.index = plugin.getIndex();
        this.operations = plugin.getOperations();
        this.days = new TimelineDays({
            today: () => this.visualToday(),
            pastDaysToShow: () => this.plugin.settings.pastDaysToShow,
            pullsToOverdue: () => this.plugin.settings.startFromOldestOverdue,
            oldestOverdue: () => this.findOldestOverdueDate(),
        });
        this.sidebarManager = new SidebarManager({
            mobileBreakpointPx: MOBILE_BREAKPOINT_PX,
            onPersist: () => this.app.workspace.requestSaveLayout(),
            onSyncToggleButton: () => this.toolbar?.syncSidebarToggleState(),
            onRequestClose: () => this.setSidebarOpen(false),
            getIsOpen: () => this.isSidebarOpen(),
        });
        const cards = createCardRendering({
            app: this.app,
            plugin: this.plugin,
            getHoverParent: () => this.hoverParent,
            getMaskMode: () => this.state.maskMode ?? false,
            // ハブが開いた時点で card の選択状態は不要なので解除する。
            //
            // `selectTask(null)` は handle DOM ごと除去する破壊的操作なので、トリガと
            // なった pointerdown の touch sequence が **完全に終わってから** 走らせる。
            // pointerdown handler 内で同期に呼ぶと、元 touch target (handle 内 SVG path)
            // が detached → 後続 pointerup/click が `.modal-bg` にリターゲットされ、
            // Obsidian Modal の outside-click で modal が即閉じる (Android Chromium で
            // 観測。CDP 実機トレース確認済み)。`setTimeout(0)` の macrotask 境界で
            // touchend / pointerup / click の dispatch をすべて消化させてから DOM を
            // 触る。modal は selection ring を視覚的に覆い隠すので、close 後に ring が
            // 残らないという元 commit (7c43222) の意図はそのまま満たされる。
            afterHubOpen: () => setTimeout(() => this.handleManager?.selectTask(null), 0),
        });
        this.taskRenderer = cards.taskRenderer;
        this.menuHandler = cards.menuHandler;
        this.addChild(this.taskRenderer);

        this.store.subscribe((patch, prev) => {
            // A new day looked at, or following again: the pull is read anew.
            if ('date' in patch && patch.date !== prev.date) this.days.settle(this.state.date);
        });

        this.pinnedLists = new PinnedListPanel({
            plugin: this.plugin,
            readService: this.readService,
            index: this.index,
            taskRenderer: this.taskRenderer,
        }, {
            state: () => this.state,
            subscribe: (listener) => this.store.subscribe(listener),
            write: (patch) => this.update(patch, { draw: false }),
        });
    }

    protected openView(): void {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('timeline-view');
        this.sidebarManager.attach(this.container, (el, ev, handler) =>
            this.registerDomEvent(el, ev, handler),
        );

        // Initialize HandleManager
        this.handleManager = new HandleManager(this.container, {
            getTask: (id) => this.index.getTask(id),
            getStartHour: () => this.plugin.settings.startHour,
        });
        this.selectionController = new SelectionController(this.handleManager);

        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);

        // Construct the toolbar once for the lifetime of this view. performRender()
        // calls toolbar.detach() before container.empty() and toolbar.mount(host)
        // after, so the toolbar's DOM survives renders. That is what lets the
        // filter popover stay open across data-driven re-renders.
        this.toolbar = new TimelineToolbar({
            host: this.toolbarHost(),
            commands: {
                navigateDays: (n) => this.update(this.days.moved(this.state.date, daysToShowOf(this.state), n)),
                jumpToNow: () => {
                    this.scrollToNowOnNextRender = true;
                    this.update(this.days.now());
                },
                jumpToDate: (date) => this.update(this.days.goTo(date)),
                viewedDay: () => this.days.viewedDay(this.state.date),
                window: () => this.window(),
                isSidebarOpen: () => this.isSidebarOpen(),
                toggleSidebar: (open) => {
                    if (open) this.sidebarOpenedThisSession = true;
                    this.setSidebarOpen(open);
                },
            },
            linkInteractionManager: this.linkInteractionManager,
            hoverParent: this.hoverParent,
        });

        // Initialize Renderers
        this.allDayRenderer = new AllDaySectionRenderer(this.plugin, this.taskRenderer);
        this.timelineRenderer = new TimelineSectionRenderer(this.plugin, this.taskRenderer, () => this.zoom());
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
            () => this.state,
            this.plugin,
            this.menuHandler,
            this.hoverParent,
            this.dateHeaderRenderer,
            this.periodicHeaderRenderer,
        );
        this.pinnedLists.open();
        this.moonRenderer = new MoonPhaseRenderer();

        // Initialize DragHandler with selection callback, move callback, and the window drawn
        this.dragHandler = new DragHandler(this.container, this.operations, this.plugin,
            this.selectionController,
            (taskId: string) => {
                // Store base task id so split segments all share one selection and
                // the selection survives a drag-move that regenerates segment ids.
                const segInfo = parseSegmentId(taskId);
                const baseId = segInfo?.baseId ?? taskId;
                this.handleManager.selectTask(baseId);
            },
            () => this.window().start,
            () => windowEnd(this.window()),
            () => this.zoom()
        );

        // Background click → deselect、UI 経由 delete → deselect。両方 SelectionController に集約。
        // External-editor deletions are not tracked here by design — if that
        // case causes a visual glitch (line-shifted task inherits `.is-selected`),
        // user can click to re-select.
        this.selectionController.attachBackgroundClick(this.container);
        this.unsubscribeDelete = this.selectionController.attachDeleteListener(this.index);

        // Subscribe to data changes
        this.unsubscribe = this.index.onChange((taskId, changes) => {
            // The first tasks may be what the overdue pull waited for.
            this.tryInitialPull();
            this.renderScheduler.handleChange(taskId, changes);
        });

        // Ctrl+wheel zoom. The gesture shows the zoom itself (the hour height
        // and the scroll); the state takes it without a draw.
        this.registerDomEvent(this.container, 'wheel', (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.25 : -0.25;
            const oldZoom = this.zoom();
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

            this.container.style.setProperty('--hour-height', `${60 * newZoom}px`);
            this.update({ zoomLevel: newZoom }, { draw: false });
        }, { passive: false });

        // Pinch zoom (touch devices)
        this.registerDomEvent(this.container, 'touchstart', (e: TouchEvent) => {
            if (e.touches.length !== 2) return;
            this.isPinching = true;
            this.pinchInitialDistance = this.getTouchDistance(e.touches);
            this.pinchInitialZoom = this.zoom();

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
            const oldZoom = this.zoom();
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

            this.container.style.setProperty('--hour-height', `${60 * newZoom}px`);
            this.update({ zoomLevel: newZoom }, { draw: false });
        }, { passive: false });

        this.registerDomEvent(this.container, 'touchend', (e: TouchEvent) => {
            if (!this.isPinching) return;
            if (e.touches.length < 2) this.isPinching = false;
        }, { passive: true });
        this.registerDomEvent(this.container, 'touchcancel', () => {
            this.isPinching = false;
        }, { passive: true });

        this.stickyAnchorObserver = new ResizeObserver(() => {
            this.updateStickyHeaderTops();
        });

        // The first draw scrolls to the current time.
        this.scrollToNowOnNextRender = true;
    }

    protected override onReady(): void {
        this.stateReady = true;
        this.tryInitialPull();
    }

    /**
     * Read the overdue pull for the first time, once the view is open with
     * its state and its tasks. A view on a fixed day has none to read.
     */
    private tryInitialPull(): void {
        if (this.hasPulled || !this.stateReady) return;
        if (this.index.getTasks().length === 0) return;
        this.hasPulled = true;
        this.days.settle(this.state.date);
        this.requestDraw();
    }

    protected closeView(): void {
        this.hoverParent.dispose();
        this.toolbar?.close();
        this.dragHandler.destroy();
        this.pinnedLists.close();
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.unsubscribeDelete) {
            this.unsubscribeDelete();
        }
        this.sidebarManager.detach();
        if (this.stickyAnchorObserver) {
            this.stickyAnchorObserver.disconnect();
            this.stickyAnchorObserver = null;
        }
        this.frames.dispose();
    }

    /** The zoom drawn: the view's own, or the global setting. */
    private zoom(): number {
        return effectiveZoom(this.state, this.plugin.settings);
    }

    /** The days drawn. */
    private window(): DayWindow {
        return this.days.window(this.state.date, daysToShowOf(this.state));
    }

    /** Whether the sidebar shows: closed at narrow width until the toggle opens it this session. */
    private isSidebarOpen(): boolean {
        if (this.sidebarManager.isNarrow() && !this.sidebarOpenedThisSession) return false;
        return this.state.showSidebar ?? true;
    }

    /** Open or close the sidebar, sliding; the draw does not rebuild it. */
    private setSidebarOpen(open: boolean): void {
        this.update({ showSidebar: open }, { draw: false });
        this.sidebarManager.applyOpen(open, { animate: true });
    }

    /** Settings were saved: the window is read anew, and a view following today pulls anew. */
    override redraw(): void {
        this.days.settle(this.state.date);
        this.requestDraw();
    }

    /** The visual day changed: a view following today moves to it and scrolls to now; a fixed one stays. */
    override onDayRolled(): void {
        if (this.days.dayRolled(this.state.date)) this.scrollToNowOnNextRender = true;
        this.requestDraw();
    }

    /** A minute passed: move the now-line. Before the view opens there is none. */
    override onMinute(): void {
        if (!this.container) return;
        this.renderCurrentTimeIndicator();
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

    /** Draw the whole view, keeping the time at the top of the scroll. */
    protected draw(): void {
        this.saveScrollPosition();
        this.performRender();
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

    private performRender() {
        this.sidebarManager.syncPresentation(this.isSidebarOpen(), { animate: false });

        // Detach the toolbar before empty() so its DOM (and the FilterMenuComponent
        // bound to it) survives. We re-attach it via mount() below.
        this.toolbar?.detach();
        // The pinned lists come out before the grid's cards are gathered, so
        // their cards are neither taken for the grid's nor lost; they go back
        // into the sidebar built below.
        this.pinnedLists.lift();

        // Keyed reconciliation: lift surviving cards into a key→element map
        // before tearing down the scaffolding. Cards retain their inner DOM /
        // markdown / Component lifecycle, and will be re-parented + re-decorated
        // when their key turns up in the new render. Stale survivors are
        // disposed at the end.
        const reconciler = new CardReconciler();
        reconciler.detach(this.container);

        this.container.empty();

        // Apply Zoom Level
        const zoomLevel = this.zoom();
        this.container.style.setProperty('--hour-height', `${60 * zoomLevel}px`);

        // Measure and set actual scrollbar width for grid alignment
        const scrollbarWidth = this.measureScrollbarWidth();
        this.container.style.setProperty('--scrollbar-width-actual', `${scrollbarWidth}px`);

        // Toolbar host (top row)
        const toolbarHost = this.container.createDiv('timeline-view__toolbar-host');

        // Build sidebar layout (bottom row)
        const { main, sidebarHeader, sidebarBody } = this.sidebarManager.buildLayout(this.container);

        this.pinnedLists.mount(sidebarHeader, sidebarBody);

        const dates = windowDates(this.window());

        // Mount the persistent toolbar instance into this render's toolbarHost.
        // First call builds DOM; subsequent calls re-attach the existing rootEl.
        this.toolbar!.mount(toolbarHost);

        // Use GridRenderer (render into main column)
        const filteredTasks = this.readService.getTasksForDateRange(
            dates[0], dates[dates.length - 1], this.state.filterState
        );
        this.gridRenderer.render(
            main,
            this.allDayRenderer,
            this.timelineRenderer,
            this.moonRenderer,
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
        // on first paint) followed by two rAF re-applies. The cards are drawn
        // whole by now (TaskCardRenderer.render is synchronous); the
        // re-applies wait for the heights of the leaves and the all-day row
        // to settle, and for content that is truly asynchronous (an image, an
        // embed) to come in. Whether the second is needed was not measured.
        // Mirrors the scrollToCurrentTime three-pass pattern from 4029ac9 /
        // 7c44468. The re-applies run on the container's own window so a
        // popout view is not waiting on the main window's frame clock.
        const newGrid = this.container.querySelector('.timeline-grid') as HTMLElement | null;
        if (newGrid) {
            if (this.scrollToNowOnNextRender) {
                this.scrollToNowOnNextRender = false;
                this.scrollToCurrentTime();
                this.frames.after(1, () => this.scrollToCurrentTime());
                this.frames.after(2, () => this.scrollToCurrentTime());
            } else if (this.savedScrollAnchor !== null) {
                this.applyScrollAnchor();
                this.frames.after(1, () => this.applyScrollAnchor());
                this.frames.after(2, () => this.applyScrollAnchor());
            }
        }

        // The selection is shown by HandleManager alone: `.is-selected` and the
        // handles on the selected task's cards, taken off every other card. It
        // runs on every draw, a selection or none, since a kept card may carry
        // the class from the draw before. Run in the same task as the draw, the
        // first paint already has the class and the handles.
        this.handleManager.reapplySelectionClass();
    }

    /**
     * Measures the actual scrollbar width for the current environment.
     * Returns 0 for overlay scrollbars (iOS/macOS), ~15px for classic scrollbars (Windows).
     */
    private static cachedScrollbarWidth: number | null = null;

    private measureScrollbarWidth(): number {
        if (TimelineView.cachedScrollbarWidth !== null) return TimelineView.cachedScrollbarWidth;

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

        TimelineView.cachedScrollbarWidth = scrollbarWidth;
        return scrollbarWidth;
    }

    private getTouchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ==================== Export ====================

    /**
     * The days drawn, for image export, read from the same window the grid
     * is drawn from; the anchor is the day the view looks at.
     */
    getExportedDateRange(): { anchor: string; from: string; to: string } | null {
        const window = this.window();
        return { anchor: this.days.viewedDay(this.state.date), from: window.start, to: windowEnd(window) };
    }

    // ==================== Overdue Date Logic ====================

    /**
     * Finds the oldest date with incomplete overdue tasks the view's filter
     * keeps. Returns null if all past tasks are completed.
     */
    private findOldestOverdueDate(): string | null {
        const startHour = this.plugin.settings.startHour;
        const displayTasks = this.readService.getFilteredTasks(this.state.filterState ?? createEmptyFilterState());

        return findOldestOverdueDate(displayTasks, startHour, this.plugin.settings.statusDefinitions, this.readService);
    }
}
