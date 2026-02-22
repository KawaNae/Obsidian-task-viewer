import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { TaskIndex } from '../../services/core/TaskIndex';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { isCompleteStatusChar } from '../../types';
import type { RenderableTask } from '../utils/RenderableTaskUtils';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import TaskViewerPlugin from '../../main';
import { TaskStyling } from '../utils/TaskStyling';
import { DateNavigator } from '../ViewToolbar';
import { FilterMenuComponent } from '../filter/FilterMenuComponent';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { HabitTrackerRenderer } from '../timelineview/renderers/HabitTrackerRenderer';
import type { CollapsibleSectionKey, TimedRenderableTask } from './ScheduleTypes';
import { ScheduleGridCalculator } from './utils/ScheduleGridCalculator';
import { ScheduleTaskCategorizer } from './utils/ScheduleTaskCategorizer';
import { ScheduleOverlapLayout } from './utils/ScheduleOverlapLayout';
import { ScheduleGridRenderer } from './renderers/ScheduleGridRenderer';
import { ScheduleTaskRenderer } from './renderers/ScheduleTaskRenderer';
import { ScheduleSectionRenderer } from './renderers/ScheduleSectionRenderer';
import { VIEW_META_SCHEDULE } from '../../constants/viewRegistry';

export const VIEW_TYPE_SCHEDULE = VIEW_META_SCHEDULE.type;

export class ScheduleView extends ItemView {
    private static readonly HOURS_PER_DAY = 24;
    private static readonly MIN_GAP_HEIGHT_PX = 30;
    private static readonly MAX_GAP_HEIGHT_PX = 100;
    private static readonly TIMELINE_TOP_PADDING_PX = 16;
    private static readonly TIMELINE_BOTTOM_PADDING_PX = 16;

    private readonly taskIndex: TaskIndex;
    private readonly plugin: TaskViewerPlugin;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly habitRenderer: HabitTrackerRenderer;
    private readonly filterMenu = new FilterMenuComponent();
    private readonly menuHandler: MenuHandler;
    private readonly gridCalculator: ScheduleGridCalculator;
    private readonly taskCategorizer: ScheduleTaskCategorizer;
    private readonly overlapLayout: ScheduleOverlapLayout;
    private readonly gridRenderer: ScheduleGridRenderer;
    private readonly scheduleTaskRenderer: ScheduleTaskRenderer;
    private readonly sectionRenderer: ScheduleSectionRenderer;

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private currentDate = '';
    private collapsedSections: Record<CollapsibleSectionKey, boolean> = {
        allDay: false,
        deadlines: false,
    };

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.taskRenderer = new TaskCardRenderer(this.app, this.taskIndex, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.leaf,
        });
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app);
        this.habitRenderer = new HabitTrackerRenderer(this.app, this.plugin);
        this.menuHandler = new MenuHandler(this.app, this.taskIndex, this.plugin);
        this.gridCalculator = new ScheduleGridCalculator({
            getStartHour: () => this.plugin.settings.startHour,
            hoursPerDay: ScheduleView.HOURS_PER_DAY,
            minGapHeightPx: ScheduleView.MIN_GAP_HEIGHT_PX,
            maxGapHeightPx: ScheduleView.MAX_GAP_HEIGHT_PX,
        });
        this.taskCategorizer = new ScheduleTaskCategorizer({
            taskIndex: this.taskIndex,
            filterMenu: this.filterMenu,
            getStartHour: () => this.plugin.settings.startHour,
            gridCalculator: this.gridCalculator,
        });
        this.overlapLayout = new ScheduleOverlapLayout();
        this.gridRenderer = new ScheduleGridRenderer(this.gridCalculator, ScheduleView.TIMELINE_TOP_PADDING_PX);
        this.scheduleTaskRenderer = new ScheduleTaskRenderer({
            app: this.app,
            component: this,
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
            currentDateProvider: () => this.currentDate,
        });
    }

    getViewType(): string {
        return VIEW_TYPE_SCHEDULE;
    }

    getDisplayText(): string {
        return VIEW_META_SCHEDULE.displayText;
    }

    getIcon(): string {
        return VIEW_META_SCHEDULE.icon;
    }

    async setState(state: any, result: any): Promise<void> {
        if (state && typeof state.currentDate === 'string' && this.isValidDateKey(state.currentDate)) {
            this.currentDate = state.currentDate;
        }

        if (state && state.filterState) {
            this.filterMenu.setFilterState(FilterSerializer.fromJSON(state.filterState));
        } else if (state && Object.prototype.hasOwnProperty.call(state, 'filterFiles')) {
            const raw = state.filterFiles;
            if (Array.isArray(raw)) {
                const files = raw.filter((value: unknown): value is string => typeof value === 'string');
                if (files.length > 0) {
                    this.filterMenu.setFilterState({
                        conditions: [{
                            id: 'migrated-file',
                            property: 'file',
                            operator: 'includes',
                            value: { type: 'stringSet', values: files },
                        }],
                        logic: 'and',
                    });
                }
            }
        }

        await super.setState(state, result);
        if (this.container) {
            await this.render();
        }
    }

    getState(): Record<string, unknown> {
        const filterState = this.filterMenu.getFilterState();
        const result: Record<string, unknown> = {
            currentDate: this.currentDate,
        };
        if (filterState.conditions.length > 0) {
            result.filterState = FilterSerializer.toJSON(filterState);
        }
        return result;
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('schedule-view-container');

        if (!this.currentDate) {
            this.currentDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        }

        this.registerKeyboardNavigation();
        await this.render();

        this.unsubscribe = this.taskIndex.onChange(() => {
            void this.render();
        });
    }

    async onClose(): Promise<void> {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    public refresh(): void {
        void this.render();
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

    private async render(): Promise<void> {
        if (!this.container) {
            return;
        }

        this.container.empty();
        const toolbarHost = this.container.createDiv('schedule-view__toolbar-host');
        this.renderToolbar(toolbarHost);

        const tasks = this.taskCategorizer.getTasksForDate(this.currentDate);
        this.menuHandler.setViewStartDate(this.currentDate);

        const fixedHost = this.container.createDiv('schedule-view__fixed-host');
        const fixedContainer = fixedHost.createDiv('schedule-view__container schedule-view__fixed-rows');

        const bodyScroll = this.container.createDiv('schedule-view__body-scroll schedule-body-scroll');
        const bodyContainer = bodyScroll.createDiv('schedule-view__container schedule-view__scroll-content');

        await this.renderDayTimeline(fixedContainer, bodyContainer, this.currentDate, tasks);
    }

    private renderToolbar(parent: HTMLElement): void {
        const toolbar = parent.createDiv('view-toolbar');
        DateNavigator.render(
            toolbar,
            (days) => this.navigateDate(days),
            () => {
                this.currentDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
                void this.app.workspace.requestSaveLayout();
                void this.render();
            }
        );

        toolbar.createDiv('view-toolbar__spacer');

        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', 'Filter');
        filterBtn.setAttribute('title', 'Filter');
        filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());
        filterBtn.addEventListener('click', (event: MouseEvent) => {
            this.filterMenu.showMenu(event, {
                onFilterChange: () => {
                    void this.app.workspace.requestSaveLayout();
                    void this.render();
                    filterBtn.classList.toggle('is-filtered', this.filterMenu.hasActiveFilters());
                },
                getTasks: () => this.taskIndex.getTasks(),
                getFileColor: (filePath) => TaskStyling.getFileColor(this.app, filePath, this.plugin.settings.frontmatterTaskKeys.color),
            });
        });
    }

    private async renderDayTimeline(
        fixedContainer: HTMLElement,
        bodyContainer: HTMLElement,
        date: string,
        tasks: RenderableTask[]
    ): Promise<void> {
        const categorized = this.taskCategorizer.categorizeTasksBySection(tasks, date);

        this.renderDateHeader(fixedContainer, date);
        this.renderHabitsSection(fixedContainer, date);
        await this.sectionRenderer.renderAllDaySection(fixedContainer, categorized.allDay);

        await this.renderTimelineMain(bodyContainer, categorized.timed);

        if (categorized.deadlines.length > 0) {
            await this.sectionRenderer.renderCollapsibleTaskSection(
                bodyContainer,
                'schedule-deadline-section',
                'Deadlines',
                categorized.deadlines,
                'deadlines'
            );
        }
    }

    private async renderTimelineMain(container: HTMLElement, tasks: TimedRenderableTask[]): Promise<void> {
        const main = container.createDiv('schedule-grid');
        const layout = this.gridCalculator.buildAdaptiveGrid(tasks);
        const timelineHeight = layout.totalHeight + ScheduleView.TIMELINE_TOP_PADDING_PX + ScheduleView.TIMELINE_BOTTOM_PADDING_PX;
        main.style.height = `${timelineHeight}px`;

        this.gridRenderer.renderTimeMarkers(main, layout.rows, tasks);
        const placements = this.scheduleTaskRenderer.placeTasksOnGrid(tasks, layout.rows);
        await this.scheduleTaskRenderer.renderTaskCards(main, placements, timelineHeight);

        if (this.isCurrentVisualDate(this.currentDate)) {
            this.gridRenderer.renderNowLine(main, layout.rows, timelineHeight);
        }
    }

    private renderDateHeader(container: HTMLElement, date: string): void {
        const row = container.createDiv('timeline-row date-header');
        row.style.gridTemplateColumns = this.getScheduleRowColumns();
        row.createDiv('date-header__cell').setText(' ');

        const dateCell = row.createDiv('date-header__cell');
        dateCell.dataset.date = date;

        const dateObj = this.parseLocalDate(date);
        const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(this.app, dateObj);
        const linkLabel = DailyNoteUtils.getDailyNoteLabelForDate(this.app, dateObj);
        const fullLabel = `${linkLabel} ${dayName}`;
        const linkEl = dateCell.createEl('a', { cls: 'internal-link date-header__date-link', text: fullLabel });
        linkEl.dataset.href = linkTarget;
        linkEl.setAttribute('href', linkTarget);
        linkEl.setAttribute('aria-label', `Open daily note: ${fullLabel}`);
        linkEl.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });

        const todayVisualDate = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        if (date === todayVisualDate) {
            dateCell.addClass('is-today');
        }
        if (date < todayVisualDate) {
            const tasksForDate = this.taskIndex.getTasksForVisualDay(date, this.plugin.settings.startHour);
            const hasOverdueTasks = tasksForDate.some((task) =>
                !isCompleteStatusChar(task.statusChar, this.plugin.settings.completeStatusChars)
            );
            if (hasOverdueTasks) {
                dateCell.addClass('has-overdue');
            }
        }

        this.linkInteractionManager.bind(
            dateCell,
            {
                sourcePath: '',
                hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                hoverParent: this.leaf as HoverParent,
            },
            { bindClick: false }
        );

        dateCell.addEventListener('click', () => {
            void this.openOrCreateDailyNote(dateObj);
        });
    }

    private renderHabitsSection(container: HTMLElement, date: string): void {
        if (this.plugin.settings.habits.length === 0) {
            return;
        }
        const row = container.createDiv('timeline-row habits-section');
        row.style.gridTemplateColumns = this.getScheduleRowColumns();
        this.habitRenderer.render(row, [date]);
    }

    private getScheduleRowColumns(): string {
        return 'var(--schedule-axis-width) minmax(0, 1fr)';
    }

    private navigateDate(offset: number): void {
        const date = this.parseLocalDate(this.currentDate);
        date.setDate(date.getDate() + offset);
        this.currentDate = DateUtils.getLocalDateString(date);
        void this.app.workspace.requestSaveLayout();
        void this.render();
    }

    private isCurrentVisualDate(dateStr: string): boolean {
        return dateStr === DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
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
