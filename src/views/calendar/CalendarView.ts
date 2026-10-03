import type { WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type { MenuHandler } from '../../interaction/menu/MenuHandler';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { createCardRendering } from '../sharedUI/CardRendering';
import type { DisplayTask } from '../../types';
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
import { getColumnOffset, getGridColumnForDay } from './CalendarDateUtils';
import { gridAt, gridFollowingToday, gridRange, gridShifted, referenceMonth, weekStartOf } from './CalendarGrid';
import { DragHandler } from '../../interaction/drag/DragHandler';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { CalendarToolbar } from './CalendarToolbar';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { CalendarCodec, type CalendarConfig, type CalendarTransient } from './CalendarSchema';
import { HandleManager } from '../sharedUI/handles/HandleManager';
import { SelectionController } from '../../interaction/selection/SelectionController';
import { parseSegmentId } from '../../services/display/SegmentIds';
import { SidebarManager } from '../sidebar/SidebarManager';
import { PinnedListPanel } from '../sharedUI/PinnedListPanel';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { PixelScrollRestorer } from '../sharedUI/PixelScrollRestorer';
import { drawDateGridLane } from '../sharedUI/DateGridLane';
import { TaskViewerView } from '../base/TaskViewerView';
import { viewedDay } from '../base/ViewedDay';




/**
 * Calendar View - six weeks of tasks on a month grid.
 *
 * Its state is CalendarSchema's config and transient fields, held in the
 * base's store. The weeks it draws are read from where it is (`date`,
 * absent while it follows today, and `weekOffset`) by `CalendarGrid`.
 */
export class CalendarView extends TaskViewerView<CalendarConfig, CalendarTransient> {
    private readonly readService: TaskReadService;
    /** The index's copies and changes (`PluginContext.getIndex`). */
    private readonly index: IndexReads;
    private readonly operations: Operations;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;

    private menuHandler: MenuHandler;
    private dragHandler: DragHandler | null = null;
    private handleManager: HandleManager | null = null;
    private selectionController: SelectionController | null = null;
    private sidebarManager: SidebarManager;
    /** The sidebar's pinned lists; they draw themselves, and outlive the view's draws. */
    private readonly pinnedLists: PinnedListPanel;
    private readonly toolbar: CalendarToolbar;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private unsubscribeDelete: (() => void) | null = null;
    private readonly scrollRestorer = new PixelScrollRestorer(
        () => this.container?.querySelector('.cal-grid__body') as HTMLElement | null,
    );
    /**
     * At narrow width the sidebar starts closed whatever the state says, and
     * only the toggle button opens it. `showSidebar` states the desktop-width
     * position; applying a config never marks the sidebar as user-opened.
     */
    private sidebarOpenedThisSession = false;
    private readonly hoverParent = new TaskViewHoverParent();

    getViewType(): string {
        return CalendarCodec.schema.viewType;
    }

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext & TimerHost) {
        super(leaf, plugin, CalendarCodec);
        this.readService = plugin.getTaskReadService();
        this.index = plugin.getIndex();
        this.operations = plugin.getOperations();
        const cards = createCardRendering({
            app: this.app,
            plugin: this.plugin,
            getHoverParent: () => this.hoverParent,
            getMaskMode: () => this.state.maskMode ?? false,
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
            onRequestClose: () => this.setSidebarOpen(false),
            getIsOpen: () => this.isSidebarOpen(),
        });

        this.toolbar = new CalendarToolbar({
            host: this.toolbarHost(),
            commands: {
                navigateWeeks: (n) => this.navigateWeeks(n),
                today: () => this.update(gridFollowingToday()),
                goTo: (date) => this.update(gridAt(date)),
                viewedDay: () => viewedDay(this.state.date, this.visualToday()),
                referenceMonth: () => referenceMonth(this.gridRange().start),
                isSidebarOpen: () => this.isSidebarOpen(),
                toggleSidebar: (open) => {
                    if (open) this.sidebarOpenedThisSession = true;
                    this.setSidebarOpen(open);
                },
            },
            linkInteractionManager: this.linkInteractionManager,
            hoverParent: this.hoverParent,
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

    /** The days the grid draws, read from where the view is and the week start of the settings. */
    private gridRange(): { start: string; end: string } {
        return gridRange(this.state, this.visualToday(), this.plugin.settings.weekStartDay);
    }

    /** Move the grid by `weeks` weeks: the offset moves, and a view following today fixes it. */
    private navigateWeeks(weeks: number): void {
        this.update(gridShifted(this.state, this.visualToday(), weeks));
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

    protected openView(): void {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('calendar-view');
        this.sidebarManager.attach(this.container, (el, ev, handler) =>
            this.registerDomEvent(el, ev, handler),
        );

        this.pinnedLists.open();
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
            () => this.gridRange().start,
            () => this.gridRange().end,
            () => this.plugin.settings.zoomLevel
        );

        this.selectionController.attachBackgroundClick(this.container);

        // Clear selection when the selected task is deleted via the UI.
        this.unsubscribeDelete = this.selectionController.attachDeleteListener(this.index);

        this.unsubscribe = this.index.onChange((taskId, changes) => {
            this.renderScheduler.handleChange(taskId, changes);
        });
    }

    protected closeView(): void {
        this.hoverParent.dispose();
        this.toolbar.close();
        this.sidebarManager.detach();
        this.pinnedLists.close();

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
        this.scrollRestorer.dispose();
    }

    /** Draw the grid, keeping the scroll. */
    protected draw(): void {
        this.scrollRestorer.save();
        this.performRender();
    }

    private performRender(): void {
        this.sidebarManager.syncPresentation(this.isSidebarOpen(), { animate: false });

        this.toolbar.detach();
        // The pinned lists come out before the grid's cards are gathered, so
        // their cards are neither taken for the grid's nor lost; they go back
        // into the sidebar built below.
        this.pinnedLists.lift();

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

        this.pinnedLists.mount(sidebarHeader, sidebarBody);

        const calendarHost = main.createDiv('cal-grid');

        const { start: rangeStartStr, end: rangeEndStr } = this.gridRange();
        this.menuHandler.setViewStartDate(rangeStartStr);

        const allVisibleTasks = this.getVisibleTasksInRange(rangeStartStr, rangeEndStr);
        const body = calendarHost.createDiv('cal-grid__body');
        this.renderWeekdayHeader(body);
        const month = referenceMonth(rangeStartStr);
        const showWeekNumbers = this.shouldShowWeekNumbers();
        const today = this.visualToday();

        const cursor = DateUtils.parseDate(rangeStartStr);
        const endDate = DateUtils.parseDate(rangeEndStr);
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
                this.renderWeekNumberCell(weekRow, weekStartDate, today);
            }

            for (let i = 0; i < 7; i++) {
                const cellDate = new Date(cursor);
                const dateKey = DateUtils.getLocalDateString(cellDate);
                weekDates.push(dateKey);
                this.renderDateHeader(weekRow, cellDate, i + 1, month, today);
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

    private renderDateHeader(
        weekRow: HTMLElement,
        date: Date,
        colIndex: number,
        referenceMonth: { year: number; month: number },
        todayKey: string,
    ): void {
        const cell = weekRow.createDiv('cal-day-cell');
        const dateKey = DateUtils.getLocalDateString(date);
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
            this.state.astronomyDisplay,
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

    /** The week's tasks on the row, under the day headers: the lane Timeline's all-day row draws too. */
    private renderWeekTasks(weekRow: HTMLElement, weekDates: string[], allTasks: DisplayTask[], reconciler: CardReconciler): void {
        const tracks = drawDateGridLane(weekRow, allTasks, {
            dates: weekDates,
            colOffset: getColumnOffset(this.shouldShowWeekNumbers()),
            firstRow: 2,
            scope: 'lane',
            timeOnSingleDay: true,
        }, { taskRenderer: this.taskRenderer, settings: this.plugin.settings, reconciler });
        if (tracks > 0) {
            weekRow.style.gridTemplateRows = `var(--calendar-header-height) repeat(${tracks}, minmax(var(--calendar-track-height), auto))`;
        }
    }

    private getVisibleTasksInRange(rangeStart: string, rangeEnd: string): DisplayTask[] {
        return this.readService.getTasksForDateRange(rangeStart, rangeEnd, this.state.filterState);
    }

    /**
     * The days drawn, for image export: the six weeks the grid draws (not the
     * calendar month), read from the same range as the draw. The anchor is
     * the day looked at (today while the view follows it), as in Timeline.
     */
    getExportedDateRange(): { anchor: string; from: string; to: string } | null {
        const { start, end } = this.gridRange();
        return { anchor: viewedDay(this.state.date, this.visualToday()), from: start, to: end };
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

    private renderWeekNumberCell(weekRow: HTMLElement, weekStartDate: Date, today: string): void {
        const weekNumberEl = weekRow.createDiv('cal-week-number');
        const weekNumber = withWeekStartDay(weekStartDate, this.plugin.settings.weekStartDay).week();

        if (DateUtils.getLocalDateString(weekStartDate) === weekStartOf(today, this.plugin.settings.weekStartDay)) {
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
}
