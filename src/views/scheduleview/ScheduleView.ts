import { ItemView, WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { t } from '../../i18n';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { isCompleteStatusChar } from '../../types';
import type { DisplayTask, AstronomyDisplay } from '../../types';
import { getEffectiveAstronomyDisplay } from '../../services/astronomy/AstronomyService';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { TaskDetailModal } from '../../modals/TaskDetailModal';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { ChildLineMenuBuilder } from '../../interaction/menu/builders/ChildLineMenuBuilder';
import TaskViewerPlugin from '../../main';

import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import { createEmptyFilterState, hasConditions, type FilterState } from '../../services/filter/FilterTypes';
import { ScheduleToolbar } from './ScheduleToolbar';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { HabitTrackerRenderer } from '../sharedUI/HabitTrackerRenderer';
import { MoonPhaseRenderer } from '../sharedUI/MoonPhaseRenderer';
import { attachSunIndicators, attachSunAxisArrows } from '../sharedUI/AstronomyCellAdorner';
import { DateHeaderRenderer } from '../sharedUI/DateHeaderRenderer';
import { AsyncRenderSerializer } from '../sharedUI/AsyncRenderSerializer';
import { RenderScheduler } from '../sharedUI/RenderScheduler';
import { PixelScrollRestorer } from '../sharedUI/PixelScrollRestorer';
import { PeriodicHeaderRenderer, type PeriodicHeaderRenderResult } from '../sharedUI/PeriodicHeaderRenderer';
import type { CollapsibleSectionKey, TimedDisplayTask } from './ScheduleTypes';
import { ScheduleGridCalculator } from './utils/ScheduleGridCalculator';
import { ScheduleTaskCategorizer } from './utils/ScheduleTaskCategorizer';
import { ScheduleOverlapLayout } from './utils/ScheduleOverlapLayout';
import { ScheduleGridRenderer } from './renderers/ScheduleGridRenderer';
import { ScheduleTaskRenderer } from './renderers/ScheduleTaskRenderer';
import { ScheduleSectionRenderer } from './renderers/ScheduleSectionRenderer';
import { TaskReadService } from '../../services/data/TaskReadService';
import { splitTasks } from '../../services/display/TaskSplitter';
import { categorizeTasksForDate, type CategorizedTasks as BaseCategorizedTasks } from '../../services/display/TaskDateCategorizer';
import { TaskWriteService } from '../../services/data/TaskWriteService';
import { VIEW_META_SCHEDULE } from '../../constants/viewRegistry';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { ScheduleSchema, type ScheduleConfig, type ScheduleTransient } from './ScheduleSchema';

export const VIEW_TYPE_SCHEDULE = VIEW_META_SCHEDULE.type;

type ScheduleViewState = Partial<ScheduleConfig> & Partial<ScheduleTransient>;

export class ScheduleView extends ItemView {
    private static readonly HOURS_PER_DAY = 24;
    private static readonly MIN_GAP_HEIGHT_PX = 30;
    private static readonly MAX_GAP_HEIGHT_PX = 100;
    private static readonly TIMELINE_TOP_PADDING_PX = 16;
    private static readonly TIMELINE_BOTTOM_PADDING_PX = 16;
    private readonly plugin: TaskViewerPlugin;
    private readonly readService: TaskReadService;
    private readonly writeService: TaskWriteService;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly habitRenderer: HabitTrackerRenderer;
    private readonly moonRenderer: MoonPhaseRenderer;
    private readonly dateHeaderRenderer: DateHeaderRenderer;
    private readonly periodicHeaderRenderer: PeriodicHeaderRenderer;
    private readonly filterMenu = new FilterMenuComponent();
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
    private currentVisualDate = '';
    private scrollToNowOnNextRender = false;
    private readonly scrollRestorer = new PixelScrollRestorer(
        () => this.container?.querySelector('.schedule-view__body-scroll') as HTMLElement | null,
    );
    private customName: string | undefined;
    private periodicHeaderCollapsed: boolean = true;
    private maskMode: boolean = false;
    private astronomyDisplay: Partial<AstronomyDisplay> | undefined = undefined;
    private collapsedSections: Record<CollapsibleSectionKey, boolean> = {
        allDay: false,
        dueOnly: false,
    };

    private readonly hoverParent = new TaskViewHoverParent();

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.readService = plugin.getTaskReadService();
        this.writeService = plugin.getTaskWriteService();
        this.taskRenderer = new TaskCardRenderer(this.app, this.readService, this.writeService, this.plugin.menuPresenter, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.hoverParent,
        }, () => this.plugin.settings, () => this.maskMode);
        this.addChild(this.taskRenderer);
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);
        this.habitRenderer = new HabitTrackerRenderer(this.app, this.plugin);
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
        this.menuHandler = new MenuHandler(this.app, this.readService, this.writeService, this.plugin);
        this.taskRenderer.setChildMenuCallback((taskId, x, y) => this.menuHandler.showMenuForTask(taskId, x, y));
        const childLineMenuBuilder = new ChildLineMenuBuilder(this.app, this.writeService, this.plugin);
        this.taskRenderer.setChildLineEditCallback((parentTask, line, bodyLine, x, y) => {
            childLineMenuBuilder.showMenu(parentTask, line, bodyLine, x, y);
        });
        this.taskRenderer.setDetailCallback((task) => {
            new TaskDetailModal(this.app, task, this.taskRenderer, this.menuHandler, this.plugin.settings, this.readService).open();
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
            menuHandler: this.menuHandler,
            getSettings: () => this.plugin.settings,
            gridCalculator: this.gridCalculator,
            overlapLayout: this.overlapLayout,
            timelineTopPaddingPx: ScheduleView.TIMELINE_TOP_PADDING_PX,
        });
        this.sectionRenderer = new ScheduleSectionRenderer({
            taskRenderer: this.scheduleTaskRenderer,
            collapsedSections: this.collapsedSections,
            currentVisualDateProvider: () => this.currentVisualDate,
        });
        this.filterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.filterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.filterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);

        this.toolbar = new ScheduleToolbar({
            app: this.app,
            leaf: this.leaf,
            plugin: this.plugin,
            readService: this.readService,
            filterMenu: this.filterMenu,
            container: this.containerEl,
            onNavigate: (days) => this.navigateDate(days),
            onToday: () => {
                this.currentVisualDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
                this.scrollToNowOnNextRender = true;
                void this.app.workspace.requestSaveLayout();
                this.render();
            },
            onFilterChange: () => {
                void this.app.workspace.requestSaveLayout();
                this.render();
            },
            getCustomName: () => this.customName,
            onRename: (newName) => {
                this.customName = newName;
                this.leaf.updateHeader();
                this.app.workspace.requestSaveLayout();
            },
            getCurrentConfig: () => this.getCurrentConfig(),
            applyConfig: (cfg) => this.applyConfig(cfg),
            onConfigApplied: () => {
                this.leaf.updateHeader();
                this.app.workspace.requestSaveLayout();
                this.render();
            },
            getMaskMode: () => this.maskMode,
            setMaskMode: (next) => {
                this.maskMode = next;
                this.app.workspace.requestSaveLayout();
                this.render();
                this.toolbar.update();
            },
            getAstronomyDisplay: () => this.astronomyDisplay,
            setAstronomyDisplay: (next) => {
                this.astronomyDisplay = next;
                this.app.workspace.requestSaveLayout();
                this.render();
                this.toolbar.update();
            },
        });
    }

    getViewType(): string {
        return VIEW_TYPE_SCHEDULE;
    }

    getDisplayText(): string {
        return this.customName || VIEW_META_SCHEDULE.displayText;
    }

    getIcon(): string {
        return VIEW_META_SCHEDULE.icon;
    }

    private get codec(): ViewConfigCodec<ScheduleConfig, ScheduleTransient> {
        return codecFor(VIEW_TYPE_SCHEDULE) as ViewConfigCodec<ScheduleConfig, ScheduleTransient>;
    }

    /** REPLACE-over-defaults application of a parsed config. */
    applyConfig(cfg: Partial<ScheduleConfig>): void {
        const next: Partial<ScheduleConfig> = { ...ScheduleSchema.defaults, ...cfg };
        this.filterMenu.setFilterState(next.filterState ?? createEmptyFilterState());
        this.customName = next.customName;
        this.maskMode = next.maskMode === true;
        this.astronomyDisplay = next.astronomyDisplay
            ? { ...next.astronomyDisplay }
            : undefined;
    }

    /** Snapshot for template save / URI build. */
    getCurrentConfig(): Partial<ScheduleConfig> {
        const filterState = this.filterMenu.getFilterState();
        return {
            customName: this.customName,
            filterState: hasConditions(filterState) ? filterState : undefined,
            maskMode: this.maskMode,
            astronomyDisplay: this.astronomyDisplay,
        };
    }

    async setState(state: ScheduleViewState, result: ViewStateResult): Promise<void> {
        const stateDict = (state ?? {}) as Record<string, unknown>;
        const config = this.codec.parseConfig(stateDict);
        const transient = this.codec.parseTransient(stateDict);

        this.applyConfig(config);

        if (transient.currentDate && this.isValidDateKey(transient.currentDate)) {
            this.currentVisualDate = transient.currentDate;
        }
        if (transient.periodicHeaderCollapsed !== undefined) {
            this.periodicHeaderCollapsed = transient.periodicHeaderCollapsed;
        }

        await super.setState(state, result);
        if (this.container) {
            await this.renderSerializer.request();
        }
    }

    getState(): Record<string, unknown> {
        return {
            ...this.codec.serializeConfig(this.getCurrentConfig()),
            ...this.codec.serializeTransient({
                currentDate: this.currentVisualDate,
                periodicHeaderCollapsed: this.periodicHeaderCollapsed,
            }),
        };
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('schedule-view');

        if (!this.currentVisualDate) {
            this.currentVisualDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        }

        this.registerKeyboardNavigation();
        this.scrollToNowOnNextRender = true;
        await this.renderSerializer.request();

        this.renderScheduler = new RenderScheduler({ performFull: () => this.render() });
        this.unsubscribe = this.readService.onChange((taskId, changes) => {
            this.renderScheduler?.handleChange(taskId, changes);
        });
    }

    async onClose(): Promise<void> {
        this.hoverParent.dispose();
        this.filterMenu.close();
        this.dateHeaderRenderer.dispose();
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.renderScheduler?.dispose();
        this.renderScheduler = null;
    }

    public refresh(): void {
        this.currentVisualDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        this.scrollToNowOnNextRender = true;
        this.render();
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

    /**
     * Single serialization gate for every async render entry point
     * (render / setState / onOpen), keeping the reconciler's
     * detach→build→dispose cycle atomic against interleaving.
     */
    private readonly renderSerializer = new AsyncRenderSerializer(() => this.performRender());
    private renderScheduler: RenderScheduler | null = null;

    private render(): void {
        this.scrollRestorer.save();
        void this.renderSerializer.request();
    }

    private async performRender(): Promise<void> {
        if (!this.container) {
            return;
        }

        // Keyed reconciliation: lift surviving cards before tearing down the
        // day-timeline scaffolding. They will be re-parented + re-decorated as
        // their cardInstanceId turns up in the new render; unmatched ones are
        // disposed at the end.
        const reconciler = new CardReconciler();
        reconciler.detach(this.container);

        this.toolbar.detach();
        this.container.empty();
        const toolbarHost = this.container.createDiv('schedule-view__toolbar-host');
        this.toolbar.mount(toolbarHost);

        const filterState = this.filterMenu.getFilterState();
        const startHour = this.plugin.settings.startHour;
        const rangeTasks = this.readService.getTasksForDateRange(
            this.currentVisualDate, this.currentVisualDate, filterState
        );
        const splitResult = splitTasks(rangeTasks, { type: 'visual-date', startHour });
        const baseCategorized = categorizeTasksForDate(splitResult, this.currentVisualDate, startHour);
        this.menuHandler.setViewStartDate(this.currentVisualDate);

        const fixedHost = this.container.createDiv('schedule-view__fixed-host');
        const fixedContainer = fixedHost.createDiv('schedule-view__fixed-rows');

        const bodyScroll = this.container.createDiv('schedule-view__body-scroll');
        const bodyContainer = bodyScroll.createDiv('schedule-view__scroll-content');

        await this.renderDayTimeline(fixedContainer, bodyContainer, this.currentVisualDate, baseCategorized, reconciler);

        // Dispose any cards that did not turn up in the new render.
        reconciler.forEachStale(card => this.taskRenderer.dispose(card));

        if (this.scrollToNowOnNextRender) {
            this.scrollToNowOnNextRender = false;
            this.scrollRestorer.runGuarded(() => this.scrollToCurrentTime());
        } else {
            this.scrollRestorer.restore();
        }
    }

    private async renderDayTimeline(
        fixedContainer: HTMLElement,
        bodyContainer: HTMLElement,
        date: string,
        baseCategorized: BaseCategorizedTasks,
        reconciler: CardReconciler,
    ): Promise<void> {
        const categorized = this.taskCategorizer.toScheduleFormat(baseCategorized);

        const periodicHeader = this.periodicHeaderRenderer.render(fixedContainer, {
            dates: [date],
            gridTemplateColumns: this.getScheduleRowColumns(),
            collapsed: this.periodicHeaderCollapsed,
            onToggle: () => this.togglePeriodicHeader(),
        });

        this.renderDateHeader(fixedContainer, date, periodicHeader);

        // Moon-phase row between date header and habits — mirrors Timeline's
        // placement so the two time-axis views look symmetric.
        this.renderMoonSection(fixedContainer, date);

        // Habits in fixed area (always visible), allday in scroll body (sticky on PC)
        this.renderHabitsSection(fixedContainer, date);
        await this.sectionRenderer.renderAllDaySection(bodyContainer, categorized.allDay, reconciler);

        await this.renderTimelineMain(bodyContainer, categorized.timed, reconciler);

        if (categorized.dueOnly.length > 0) {
            await this.sectionRenderer.renderCollapsibleTaskSection(
                bodyContainer,
                'schedule-due-section',
                t('calendar.due'),
                categorized.dueOnly,
                'dueOnly',
                reconciler,
            );
        }
    }

    private async renderTimelineMain(container: HTMLElement, tasks: TimedDisplayTask[], reconciler: CardReconciler): Promise<void> {
        const main = container.createDiv('schedule-grid');
        const layout = this.gridCalculator.buildAdaptiveGrid(tasks);
        const timelineHeight = layout.totalHeight + ScheduleView.TIMELINE_TOP_PADDING_PX + ScheduleView.TIMELINE_BOTTOM_PADDING_PX;
        main.style.height = `${timelineHeight}px`;

        this.gridRenderer.renderTimeMarkers(main, layout.rows, tasks);
        const placements = this.scheduleTaskRenderer.placeTasksOnGrid(tasks, layout.rows);
        await this.scheduleTaskRenderer.renderTaskCards(main, placements, timelineHeight, reconciler);

        if (this.isCurrentVisualDate(this.currentVisualDate)) {
            this.gridRenderer.renderNowLine(main, layout.rows, timelineHeight);
        }

        const astronomyDisplay = getEffectiveAstronomyDisplay(
            this.astronomyDisplay,
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
            attachSunIndicators(main, this.currentVisualDate, {
                startHour, latitude, longitude, minutesToTopPx,
            });
            // Anchor the line with a night-direction arrow on the axis right
            // border. The markers layer carries the time labels and shares
            // the same y-coordinate system used by `minutesToTopPx`.
            const markers = main.querySelector<HTMLElement>('.schedule-grid__markers');
            if (markers) {
                attachSunAxisArrows(markers, this.currentVisualDate, {
                    startHour, latitude, longitude, minutesToTopPx,
                });
            }
        }
    }

    private renderDateHeader(container: HTMLElement, date: string, periodicHeader: PeriodicHeaderRenderResult): void {
        const todayVisualDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        const isOverdue = (d: string): boolean => {
            if (d >= todayVisualDate) return false;
            const tasksOnDate = this.readService.getTasksForDateRange(d, d, this.filterMenu.getFilterState());
            return tasksOnDate.some(dt =>
                !isCompleteStatusChar(dt.statusChar, this.plugin.settings.statusDefinitions)
            );
        };

        const { axisCell } = this.dateHeaderRenderer.render(container, {
            dates: [date],
            gridTemplateColumns: this.getScheduleRowColumns(),
            isOverdue,
            enableCompactBehavior: false,
            forceShortLabel: !this.periodicHeaderCollapsed,
        });

        periodicHeader.mountInAxisCell(axisCell);
    }

    private togglePeriodicHeader(): void {
        this.periodicHeaderCollapsed = !this.periodicHeaderCollapsed;
        void this.app.workspace.requestSaveLayout();
        this.render();
    }

    private renderHabitsSection(container: HTMLElement, date: string): void {
        const row = container.createDiv('tv-grid-row habits-section');
        row.style.gridTemplateColumns = this.getScheduleRowColumns();
        this.habitRenderer.render(row, [date]);
    }

    /**
     * Moon-phase grid row above the habits row. Symmetric with Timeline's
     * `MoonPhaseRenderer` usage — same axis/cell shape, just a single date.
     */
    private renderMoonSection(container: HTMLElement, date: string): void {
        const astronomyDisplay = getEffectiveAstronomyDisplay(
            this.astronomyDisplay,
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

    private navigateDate(offset: number): void {
        const date = this.parseLocalDate(this.currentVisualDate);
        date.setDate(date.getDate() + offset);
        this.currentVisualDate = DateUtils.getLocalDateString(date);
        void this.app.workspace.requestSaveLayout();
        this.render();
    }

    private isCurrentVisualDate(dateStr: string): boolean {
        return dateStr === DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
    }

    /** Scrolls the schedule body to center the now-line vertically. */
    private scrollToCurrentTime(): void {
        if (!this.isCurrentVisualDate(this.currentVisualDate)) return;
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

    private isValidDateKey(value: string): boolean {
        return /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    private parseLocalDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    private async openOrCreateDailyNote(date: Date): Promise<void> {
        let file = DailyNoteUtils.getDailyNote(this.app, date);
        if (!file) {
            file = await DailyNoteUtils.createDailyNote(this.app, date);
        }
        if (file) {
            await this.app.workspace.getLeaf(false).openFile(file);
        }
    }
}
