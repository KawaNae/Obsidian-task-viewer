import type { WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { createCardRendering } from '../sharedUI/CardRendering';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { getEffectiveAstronomyDisplay } from '../../services/astronomy/AstronomyService';
import type { MenuHandler } from '../../interaction/menu/MenuHandler';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { ScheduleToolbar } from './ScheduleToolbar';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { MoonPhaseRenderer } from '../sharedUI/MoonPhaseRenderer';
import { attachSunIndicators, attachSunAxisArrows } from '../sharedUI/AstronomyCellAdorner';
import { DateHeaderRenderer } from '../sharedUI/DateHeaderRenderer';
import { PixelScrollRestorer } from '../sharedUI/PixelScrollRestorer';
import { PeriodicHeaderRenderer } from '../sharedUI/PeriodicHeaderRenderer';
import type { CollapsibleSectionKey, GridRow, TimedDisplayTask } from './ScheduleTypes';
import { ScheduleGridCalculator } from './utils/ScheduleGridCalculator';
import { ScheduleTaskCategorizer } from './utils/ScheduleTaskCategorizer';
import { ScheduleOverlapLayout } from './utils/ScheduleOverlapLayout';
import { ScheduleGridRenderer } from './renderers/ScheduleGridRenderer';
import { ScheduleTaskRenderer } from './renderers/ScheduleTaskRenderer';
import { ScheduleSectionRenderer } from './renderers/ScheduleSectionRenderer';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { IndexReads } from '../../services/core/TaskIndex';
import { splitTasks } from '../../services/display/TaskSplitter';
import { categorizeTasksForDate, type CategorizedTasks as BaseCategorizedTasks } from '../../services/display/TaskDateCategorizer';
import { getOverdueLevel } from '../../services/display/TaskStatusQuery';
import { ScheduleCodec, type ScheduleConfig, type ScheduleTransient } from './ScheduleSchema';
import { TaskViewerView } from '../base/TaskViewerView';
import { followToday, followsToday, shiftedDay, viewedDay } from '../base/ViewedDay';


/**
 * Schedule View - one day on an adaptive time grid.
 *
 * Its state is ScheduleSchema's config and transient fields, held in the
 * base's store. It draws the day it looks at (`date`, absent while it
 * follows today).
 */
export class ScheduleView extends TaskViewerView<ScheduleConfig, ScheduleTransient> {
    private static readonly HOURS_PER_DAY = 24;
    private static readonly MIN_GAP_HEIGHT_PX = 30;
    private static readonly MAX_GAP_HEIGHT_PX = 100;
    private static readonly TIMELINE_TOP_PADDING_PX = 16;
    private static readonly TIMELINE_BOTTOM_PADDING_PX = 16;
    private readonly readService: TaskReadService;
    /** The index's copies and changes (`PluginContext.getIndex`). */
    private readonly index: IndexReads;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly moonRenderer: MoonPhaseRenderer;
    private readonly dateHeaderRenderer: DateHeaderRenderer;
    private readonly periodicHeaderRenderer: PeriodicHeaderRenderer;
    private readonly toolbar: ScheduleToolbar;
    private readonly menuHandler: MenuHandler;
    private readonly gridCalculator: ScheduleGridCalculator;
    private readonly taskCategorizer: ScheduleTaskCategorizer;
    private readonly overlapLayout: ScheduleOverlapLayout;
    private readonly gridRenderer: ScheduleGridRenderer;
    private readonly scheduleTaskRenderer: ScheduleTaskRenderer;
    private readonly sectionRenderer: ScheduleSectionRenderer;

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private scrollToNowOnNextRender = false;
    // Latest grid layout, cached off the last full render so the per-minute
    // now-line (`onMinute`) can re-paint without re-running buildAdaptiveGrid.
    private gridRows: GridRow[] = [];
    private gridTimelineHeight = 0;
    private readonly scrollRestorer = new PixelScrollRestorer(
        () => this.container?.querySelector('.schedule-view__body-scroll') as HTMLElement | null,
    );
    private collapsedSections: Record<CollapsibleSectionKey, boolean> = {
        allDay: false,
        dueOnly: false,
    };

    private readonly hoverParent = new TaskViewHoverParent();

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext & TimerHost) {
        super(leaf, plugin, ScheduleCodec);
        this.readService = plugin.getTaskReadService();
        this.index = plugin.getIndex();
        const cards = createCardRendering({
            app: this.app,
            plugin: this.plugin,
            getHoverParent: () => this.hoverParent,
            getMaskMode: () => this.state.maskMode ?? false,
        });
        this.taskRenderer = cards.taskRenderer;
        this.menuHandler = cards.menuHandler;
        this.addChild(this.taskRenderer);
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);
        this.moonRenderer = new MoonPhaseRenderer();
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
        this.gridCalculator = new ScheduleGridCalculator({
            getStartHour: () => this.plugin.settings.startHour,
            hoursPerDay: ScheduleView.HOURS_PER_DAY,
            minGapHeightPx: ScheduleView.MIN_GAP_HEIGHT_PX,
            maxGapHeightPx: ScheduleView.MAX_GAP_HEIGHT_PX,
        });
        this.taskCategorizer = new ScheduleTaskCategorizer({
            getStartHour: () => this.plugin.settings.startHour,
            gridCalculator: this.gridCalculator,
        });
        this.overlapLayout = new ScheduleOverlapLayout();
        this.gridRenderer = new ScheduleGridRenderer(this.gridCalculator, ScheduleView.TIMELINE_TOP_PADDING_PX);
        this.scheduleTaskRenderer = new ScheduleTaskRenderer({
            app: this.app,
            taskRenderer: this.taskRenderer,
            getSettings: () => this.plugin.settings,
            gridCalculator: this.gridCalculator,
            overlapLayout: this.overlapLayout,
            timelineTopPaddingPx: ScheduleView.TIMELINE_TOP_PADDING_PX,
        });
        this.sectionRenderer = new ScheduleSectionRenderer({
            taskRenderer: this.scheduleTaskRenderer,
            collapsedSections: this.collapsedSections,
            currentVisualDateProvider: () => this.viewedDay(),
        });

        this.toolbar = new ScheduleToolbar({
            host: this.toolbarHost(),
            commands: {
                navigate: (days) => this.navigateDate(days),
                today: () => {
                    this.scrollToNowOnNextRender = true;
                    this.update(followToday());
                },
                jumpToDate: (date) => this.update({ date }),
                viewedDay: () => this.viewedDay(),
            },
            linkInteractionManager: this.linkInteractionManager,
            hoverParent: this.hoverParent,
        });
    }

    /** The day drawn: the fixed date, or today while the view follows it. */
    private viewedDay(): string {
        return viewedDay(this.state.date, this.visualToday());
    }

    /**
     * The date currently drawn, for image export. Schedule draws exactly one
     * day, so anchor/from/to all coincide.
     */
    getExportedDateRange(): { anchor: string; from: string; to: string } | null {
        const day = this.viewedDay();
        return { anchor: day, from: day, to: day };
    }

    protected openView(): void {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('schedule-view');

        this.registerKeyboardNavigation();
        this.scrollToNowOnNextRender = true;

        this.unsubscribe = this.index.onChange((taskId, changes) => {
            this.renderScheduler.handleChange(taskId, changes);
        });
    }

    /**
     * A minute passed: move the now-line without a full render (task changes
     * and navigation are the only other triggers).
     */
    override onMinute(): void {
        if (!this.container || !this.isCurrentVisualDate(this.viewedDay())) {
            return;
        }
        const main = this.container.querySelector('.schedule-grid') as HTMLElement | null;
        if (!main || this.gridRows.length === 0) {
            return;
        }
        this.gridRenderer.updateNowLine(main, this.gridRows, this.gridTimelineHeight);
    }

    protected closeView(): void {
        this.hoverParent.dispose();
        this.toolbar.close();
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.scrollRestorer.dispose();
    }

    /** The visual day changed: a view following today moves to it and scrolls to now; a fixed one stays. */
    override onDayRolled(): void {
        if (followsToday(this.state.date)) this.scrollToNowOnNextRender = true;
        this.requestDraw();
    }

    private registerKeyboardNavigation(): void {
        this.registerDomEvent(window, 'keydown', (event: KeyboardEvent) => {
            if (this.app.workspace.getActiveViewOfType(ScheduleView) !== this) {
                return;
            }

            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                return;
            }

            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            event.preventDefault();
            this.navigateDate(event.key === 'ArrowLeft' ? -1 : 1);
        });
    }

    /** Draw the day, keeping the scroll. */
    protected draw(): void {
        this.scrollRestorer.save();
        this.performRender();
    }

    private performRender(): void {
        const day = this.viewedDay();

        // Keyed reconciliation: lift surviving cards before tearing down the
        // day-timeline scaffolding. They will be re-parented + re-decorated as
        // their key turns up in the new render; unmatched ones are
        // disposed at the end.
        const reconciler = new CardReconciler();
        reconciler.detach(this.container);

        this.toolbar.detach();
        this.container.empty();
        const toolbarHost = this.container.createDiv('schedule-view__toolbar-host');
        this.toolbar.mount(toolbarHost);

        const startHour = this.plugin.settings.startHour;
        const rangeTasks = this.readService.getTasksForDateRange(day, day, this.state.filterState);
        const splitResult = splitTasks(rangeTasks, { type: 'visual-date', startHour });
        const baseCategorized = categorizeTasksForDate(splitResult, day, startHour);
        this.menuHandler.setViewStartDate(day);

        const fixedHost = this.container.createDiv('schedule-view__fixed-host');
        const fixedContainer = fixedHost.createDiv('schedule-view__fixed-rows');

        const bodyScroll = this.container.createDiv('schedule-view__body-scroll');
        const bodyContainer = bodyScroll.createDiv('schedule-view__scroll-content');

        this.renderDayTimeline(fixedContainer, bodyContainer, day, baseCategorized, reconciler);

        // Dispose any cards that did not turn up in the new render.
        reconciler.forEachStale(card => this.taskRenderer.dispose(card));

        if (this.scrollToNowOnNextRender) {
            this.scrollToNowOnNextRender = false;
            this.scrollRestorer.runGuarded(() => this.scrollToCurrentTime());
        } else {
            this.scrollRestorer.restore();
        }
    }

    private renderDayTimeline(
        fixedContainer: HTMLElement,
        bodyContainer: HTMLElement,
        date: string,
        baseCategorized: BaseCategorizedTasks,
        reconciler: CardReconciler,
    ): void {
        const categorized = this.taskCategorizer.toScheduleFormat(baseCategorized);

        this.periodicHeaderRenderer.render(fixedContainer, {
            dates: [date],
            gridTemplateColumns: this.getScheduleRowColumns(),
        });

        this.renderDateHeader(fixedContainer, date);

        // Moon-phase row below the date header — mirrors Timeline's
        // placement so the two time-axis views look symmetric.
        this.renderMoonSection(fixedContainer, date);

        // Allday in scroll body (sticky on PC)
        this.sectionRenderer.renderAllDaySection(bodyContainer, categorized.allDay, reconciler);

        this.renderTimelineMain(bodyContainer, date, categorized.timed, reconciler);

        if (categorized.dueOnly.length > 0) {
            this.sectionRenderer.renderCollapsibleTaskSection(
                bodyContainer,
                'schedule-due-section',
                t('calendar.due'),
                categorized.dueOnly,
                'dueOnly',
                reconciler,
            );
        }
    }

    private renderTimelineMain(container: HTMLElement, date: string, tasks: TimedDisplayTask[], reconciler: CardReconciler): void {
        const main = container.createDiv('schedule-grid');
        const layout = this.gridCalculator.buildAdaptiveGrid(tasks);
        const timelineHeight = layout.totalHeight + ScheduleView.TIMELINE_TOP_PADDING_PX + ScheduleView.TIMELINE_BOTTOM_PADDING_PX;
        main.style.height = `${timelineHeight}px`;
        this.gridRows = layout.rows;
        this.gridTimelineHeight = timelineHeight;

        this.gridRenderer.renderTimeMarkers(main, layout.rows, tasks);
        const placements = this.scheduleTaskRenderer.placeTasksOnGrid(tasks, layout.rows);
        this.scheduleTaskRenderer.renderTaskCards(main, placements, timelineHeight, reconciler);

        if (this.isCurrentVisualDate(date)) {
            this.gridRenderer.renderNowLine(main, layout.rows, timelineHeight);
        }

        const astronomyDisplay = getEffectiveAstronomyDisplay(
            this.state.astronomyDisplay,
            this.plugin.settings.astronomy,
        );
        // Raise sun lines above task cards when the per-view setting asks for it.
        main.toggleClass('is-sun-front', astronomyDisplay.sunTimes && astronomyDisplay.sunTimesInFront);
        if (astronomyDisplay.sunTimes) {
            const { latitude, longitude } = this.plugin.settings.astronomy.location;
            const startHour = this.plugin.settings.startHour;
            const rows = layout.rows;
            const firstMinute = rows[0]?.minute ?? 0;
            const lastMinute = rows[rows.length - 1]?.minute ?? 24 * 60;
            // Schedule's adaptive grid: `row.minute` is in clock-minutes with
            // startHour-aware wrap. The helper's callback contract is in
            // minutes-from-startHour, so we add startHour*60 to convert.
            const minutesToTopPx = (minutesFromStart: number): number | null => {
                const visualMinute = minutesFromStart + startHour * 60;
                if (visualMinute < firstMinute || visualMinute > lastMinute) return null;
                return this.gridCalculator.getTopForMinute(visualMinute, rows)
                    + ScheduleView.TIMELINE_TOP_PADDING_PX;
            };
            attachSunIndicators(main, date, {
                startHour, latitude, longitude, minutesToTopPx,
            });
            // Anchor the line with a night-direction arrow on the axis right
            // border. The markers layer carries the time labels and shares
            // the same y-coordinate system used by `minutesToTopPx`.
            const markers = main.querySelector<HTMLElement>('.schedule-grid__markers');
            if (markers) {
                attachSunAxisArrows(markers, date, {
                    startHour, latitude, longitude, minutesToTopPx,
                });
            }
        }
    }

    private renderDateHeader(container: HTMLElement, date: string): void {
        const todayVisualDate = this.visualToday();
        const isOverdue = (d: string): boolean => {
            if (d >= todayVisualDate) return false;
            const tasksOnDate = this.readService.getTasksForDateRange(d, d, this.state.filterState);
            return tasksOnDate.some(dt =>
                getOverdueLevel(dt, this.plugin.settings.startHour, this.plugin.settings.statusDefinitions, this.readService) !== 'none'
            );
        };

        const refYear = parseInt(date.substring(0, 4), 10);
        const refMonth = parseInt(date.substring(5, 7), 10) - 1;

        this.dateHeaderRenderer.render(container, {
            dates: [date],
            gridTemplateColumns: this.getScheduleRowColumns(),
            isOverdue,
            referenceYearMonth: { year: refYear, month: refMonth },
        });
    }

    /**
     * Moon-phase grid row below the date header. Symmetric with Timeline's
     * `MoonPhaseRenderer` usage — same axis/cell shape, just a single date.
     */
    private renderMoonSection(container: HTMLElement, date: string): void {
        const astronomyDisplay = getEffectiveAstronomyDisplay(
            this.state.astronomyDisplay,
            this.plugin.settings.astronomy,
        );
        if (!astronomyDisplay.moonPhase) return;

        const row = container.createDiv('tv-grid-row moon-section');
        row.style.gridTemplateColumns = this.getScheduleRowColumns();
        this.moonRenderer.render(row, [date]);
    }

    private getScheduleRowColumns(): string {
        return 'var(--schedule-axis-width) minmax(0, 1fr)';
    }

    /** Look at the day `offset` days from the one drawn (the toolbar's arrows, the arrow keys). */
    private navigateDate(offset: number): void {
        this.update(shiftedDay(this.state.date, this.visualToday(), offset));
    }

    private isCurrentVisualDate(dateStr: string): boolean {
        return dateStr === this.visualToday();
    }

    /** Scrolls the schedule body to center the now-line vertically. */
    private scrollToCurrentTime(): void {
        if (!this.isCurrentVisualDate(this.viewedDay())) return;
        const bodyScroll = this.container.querySelector('.schedule-view__body-scroll') as HTMLElement | null;
        if (!bodyScroll) return;
        const nowLine = bodyScroll.querySelector('.schedule-grid__now-line') as HTMLElement | null;
        if (!nowLine) return;

        const nowTopPx = parseFloat(nowLine.style.top);
        if (isNaN(nowTopPx)) return;
        const grid = nowLine.parentElement;
        if (!grid) return;

        bodyScroll.scrollTop = (grid.offsetTop + nowTopPx) - bodyScroll.clientHeight / 2;
    }


}
