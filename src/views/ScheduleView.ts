import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { TaskIndex } from '../services/core/TaskIndex';
import { TaskCardRenderer } from './taskcard/TaskCardRenderer';
import { Task, isCompleteStatusChar } from '../types';
import { shouldSplitTask, splitTaskAtBoundary, RenderableTask } from './utils/RenderableTaskUtils';
import { MenuHandler } from '../interaction/menu/MenuHandler';
import { DateUtils } from '../utils/DateUtils';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import TaskViewerPlugin from '../main';
import { ViewUtils, FileFilterMenu, DateNavigator } from './ViewUtils';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../constants/hover';
import { TaskLinkInteractionManager } from './taskcard/TaskLinkInteractionManager';
import { toDisplayHeightPx, toDisplayTopPx, toLogicalHeightPx } from '../utils/TimelineCardPosition';
import { HabitTrackerRenderer } from './timelineview/renderers/HabitTrackerRenderer';

export const VIEW_TYPE_SCHEDULE = 'schedule-view';

type CollapsibleSectionKey = 'allDay' | 'deadlines';

interface TimedRenderableTask extends RenderableTask {
    visualStartMinute: number;
    visualEndMinute: number;
}

interface CategorizedTasks {
    allDay: RenderableTask[];
    timed: TimedRenderableTask[];
    deadlines: RenderableTask[];
}

interface GridRow {
    time: string;
    minute: number;
    index: number;
    top: number;
    height: number;
}

interface AdaptiveGridLayout {
    rows: GridRow[];
    totalHeight: number;
}

interface TaskPlacement {
    task: TimedRenderableTask;
    startTime: string;
    top: number;
    height: number;
    column: number;
    columnCount: number;
}

interface ClusteredTaskAssignment {
    task: TimedRenderableTask;
    column: number;
    columnCount: number;
}

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
    private readonly filterMenu = new FileFilterMenu();

    private menuHandler: MenuHandler;
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
    }

    getViewType(): string {
        return VIEW_TYPE_SCHEDULE;
    }

    getDisplayText(): string {
        return 'Schedule View';
    }

    getIcon(): string {
        return 'calendar-days';
    }

    async setState(state: any, result: any): Promise<void> {
        if (state && typeof state.currentDate === 'string' && this.isValidDateKey(state.currentDate)) {
            this.currentDate = state.currentDate;
        }

        if (state && Object.prototype.hasOwnProperty.call(state, 'filterFiles')) {
            const raw = state.filterFiles;
            if (Array.isArray(raw)) {
                const files = raw.filter((value: unknown): value is string => typeof value === 'string');
                this.filterMenu.setVisibleFiles(files.length > 0 ? new Set(files) : null);
            } else {
                this.filterMenu.setVisibleFiles(null);
            }
        }

        await super.setState(state, result);
        if (this.container) {
            await this.render();
        }
    }

    getState(): Record<string, unknown> {
        const visibleFiles = this.filterMenu.getVisibleFiles();
        return {
            currentDate: this.currentDate,
            filterFiles: visibleFiles ? Array.from(visibleFiles).sort() : null,
        };
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('schedule-view-container');
        this.menuHandler = new MenuHandler(this.app, this.taskIndex, this.plugin);

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

        const tasks = this.getTasksForDate(this.currentDate);
        this.menuHandler.setViewStartDate(this.currentDate);

        const fixedHost = this.container.createDiv('schedule-view__fixed-host');
        const fixedContainer = fixedHost.createDiv('schedule-container schedule-fixed-rows');

        const bodyScroll = this.container.createDiv('schedule-view__body-scroll schedule-body-scroll');
        const bodyContainer = bodyScroll.createDiv('schedule-container schedule-scroll-content');

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

        const spacer = toolbar.createDiv('view-toolbar__spacer');
        spacer.style.flex = '1';

        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', 'Filter files');
        filterBtn.setAttribute('title', 'Filter files');
        filterBtn.addEventListener('click', (event: MouseEvent) => {
            const files = this.getFilterableFiles(this.currentDate);
            this.filterMenu.showMenu(
                event,
                files,
                (filePath) => ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterTaskKeys.color),
                () => {
                    void this.app.workspace.requestSaveLayout();
                    void this.render();
                }
            );
        });
    }

    private async renderDayTimeline(
        fixedContainer: HTMLElement,
        bodyContainer: HTMLElement,
        date: string,
        tasks: RenderableTask[]
    ): Promise<void> {
        const categorized = this.categorizeTasksBySection(tasks, date);

        this.renderDateHeader(fixedContainer, date);
        this.renderHabitsSection(fixedContainer, date);
        await this.renderAllDaySection(fixedContainer, categorized.allDay);

        await this.renderTimelineMain(bodyContainer, categorized.timed);

        if (categorized.deadlines.length > 0) {
            await this.renderCollapsibleTaskSection(
                bodyContainer,
                'schedule-deadline-section',
                'Deadlines',
                categorized.deadlines,
                'deadlines'
            );
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

    private async renderAllDaySection(container: HTMLElement, tasks: RenderableTask[]): Promise<void> {
        const row = container.createDiv('timeline-row allday-section');
        row.style.gridTemplateColumns = this.getScheduleRowColumns();

        const axisCell = row.createDiv('allday-section__cell allday-section__axis');
        axisCell.setAttribute('role', 'button');
        axisCell.setAttribute('tabindex', '0');
        axisCell.setAttribute('aria-label', 'Toggle All Day section');

        const toggleBtn = axisCell.createEl('button', { cls: 'section-toggle-btn' });
        toggleBtn.tabIndex = -1;
        toggleBtn.setAttribute('aria-hidden', 'true');

        axisCell.createEl('span', { cls: 'allday-section__label', text: 'All Day' });

        const taskCell = row.createDiv('allday-section__cell is-first-cell is-last-cell');
        taskCell.dataset.date = this.currentDate;

        const applyCollapsedState = () => {
            const isCollapsed = this.collapsedSections.allDay;
            row.toggleClass('collapsed', isCollapsed);
            setIcon(toggleBtn, isCollapsed ? 'plus' : 'minus');
            axisCell.setAttribute('aria-expanded', (!isCollapsed).toString());
            axisCell.setAttribute('title', isCollapsed ? 'Expand All Day' : 'Collapse All Day');
        };

        const toggleCollapsed = () => {
            this.collapsedSections.allDay = !this.collapsedSections.allDay;
            applyCollapsedState();
        };

        axisCell.addEventListener('click', () => {
            toggleCollapsed();
        });

        axisCell.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleCollapsed();
            }
        });

        applyCollapsedState();

        for (const task of tasks) {
            await this.renderTaskCard(taskCell, task, false);
        }
    }

    private getScheduleRowColumns(): string {
        return 'var(--schedule-axis-width) minmax(0, 1fr)';
    }

    private async renderCollapsibleTaskSection(
        container: HTMLElement,
        sectionClass: string,
        title: string,
        tasks: RenderableTask[],
        sectionKey: CollapsibleSectionKey
    ): Promise<void> {
        const section = container.createDiv(`schedule-section collapsible ${sectionClass}`);
        const header = section.createEl('h4', { cls: 'section-header' });
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-label', `Toggle ${title} section`);

        const icon = header.createEl('button', { cls: 'section-toggle-btn collapse-icon-btn' });
        icon.tabIndex = -1;
        icon.setAttribute('aria-hidden', 'true');
        header.createSpan({ text: title });

        const applyCollapsedState = () => {
            const isCollapsed = this.collapsedSections[sectionKey];
            section.toggleClass('collapsed', isCollapsed);
            setIcon(icon, isCollapsed ? 'plus' : 'minus');
            header.setAttribute('aria-expanded', (!isCollapsed).toString());
            header.setAttribute('title', isCollapsed ? `Expand ${title}` : `Collapse ${title}`);
        };

        const toggleCollapsed = () => {
            this.collapsedSections[sectionKey] = !this.collapsedSections[sectionKey];
            applyCollapsedState();
        };

        header.addEventListener('click', () => {
            toggleCollapsed();
        });

        header.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleCollapsed();
            }
        });

        applyCollapsedState();

        const tasksContainer = section.createDiv('schedule-section-tasks');
        for (const task of tasks) {
            await this.renderTaskCard(tasksContainer, task, false);
        }
    }
    private async renderTimelineMain(container: HTMLElement, tasks: TimedRenderableTask[]): Promise<void> {
        const main = container.createDiv('schedule-timeline-main');
        const layout = this.buildAdaptiveGrid(tasks);
        const timelineHeight = layout.totalHeight + ScheduleView.TIMELINE_TOP_PADDING_PX + ScheduleView.TIMELINE_BOTTOM_PADDING_PX;
        main.style.height = `${timelineHeight}px`;

        this.renderTimeMarkers(main, layout.rows, tasks);
        const placements = this.placeTasksOnGrid(tasks, layout.rows);
        await this.renderTaskCards(main, placements, timelineHeight);

        if (this.isCurrentVisualDate(this.currentDate)) {
            this.renderNowLine(main, layout.rows, timelineHeight);
        }
    }

    private buildAdaptiveGrid(tasks: TimedRenderableTask[]): AdaptiveGridLayout {
        const dayStart = this.getDayStartMinute();
        const dayEnd = dayStart + (ScheduleView.HOURS_PER_DAY * 60);
        const boundaries = new Set<number>();

        for (let i = 0; i <= ScheduleView.HOURS_PER_DAY; i++) {
            boundaries.add(dayStart + (i * 60));
        }

        for (const task of tasks) {
            boundaries.add(this.clampMinute(task.visualStartMinute, dayStart, dayEnd));
            boundaries.add(this.clampMinute(task.visualEndMinute, dayStart, dayEnd));
        }

        const sorted = Array.from(boundaries).sort((a, b) => a - b);
        const rows: GridRow[] = [];
        let cumulativeTop = 0;

        for (let i = 0; i < sorted.length; i++) {
            const minute = sorted[i];
            const nextMinute = i < sorted.length - 1 ? sorted[i + 1] : minute;
            const gapMinutes = Math.max(0, nextMinute - minute);
            const rowHeight = i < sorted.length - 1 ? this.gapToHeight(gapMinutes) : 0;

            rows.push({
                time: this.visualMinuteToTime(minute),
                minute,
                index: i,
                top: cumulativeTop,
                height: rowHeight,
            });

            cumulativeTop += rowHeight;
        }

        return { rows, totalHeight: cumulativeTop };
    }

    private gapToHeight(minutes: number): number {
        if (minutes <= 0) {
            return toLogicalHeightPx(ScheduleView.MIN_GAP_HEIGHT_PX);
        }

        const scaledHeight = ScheduleView.MIN_GAP_HEIGHT_PX + (Math.sqrt(minutes) * 8);
        const displayHeight = Math.min(ScheduleView.MAX_GAP_HEIGHT_PX, Math.round(scaledHeight));
        const clampedDisplayHeight = Math.max(ScheduleView.MIN_GAP_HEIGHT_PX, displayHeight);
        return toLogicalHeightPx(clampedDisplayHeight);
    }

    private renderTimeMarkers(container: HTMLElement, rows: GridRow[], tasks: TimedRenderableTask[]): void {
        const markersLayer = container.createDiv('timeline-markers');
        const spannedMinutes = this.getTaskSpannedMinutes(tasks);

        for (const row of rows) {
            const marker = markersLayer.createDiv('timeline-hour-marker');
            marker.dataset.time = row.time;
            marker.style.top = `${row.top + ScheduleView.TIMELINE_TOP_PADDING_PX}px`;

            const isTaskBoundary = this.isTaskBoundary(row.minute, tasks);
            const isSpanned = spannedMinutes.has(row.minute);

            if (isTaskBoundary || !isSpanned) {
                const label = marker.createSpan('hour-label');
                label.setText(row.time);
            }

            marker.createDiv('hour-line');
        }
    }

    private getTaskSpannedMinutes(tasks: TimedRenderableTask[]): Set<number> {
        const spanned = new Set<number>();

        for (const task of tasks) {
            const start = task.visualStartMinute + 1;
            const end = task.visualEndMinute;
            for (let minute = start; minute < end; minute++) {
                spanned.add(minute);
            }
        }

        return spanned;
    }

    private isTaskBoundary(minute: number, tasks: TimedRenderableTask[]): boolean {
        return tasks.some((task) => task.visualStartMinute === minute || task.visualEndMinute === minute);
    }

    private async renderTaskCards(
        container: HTMLElement,
        placements: TaskPlacement[],
        timelineHeight: number
    ): Promise<void> {
        const tasksContainer = container.createDiv('timeline-tasks-container');
        tasksContainer.style.height = `${timelineHeight}px`;

        for (const placement of placements) {
            const wrapper = tasksContainer.createDiv('task-wrapper');
            wrapper.dataset.time = placement.startTime;
            const logicalTop = placement.top;
            const logicalHeight = placement.height;
            const displayTop = toDisplayTopPx(logicalTop);
            const displayHeight = toDisplayHeightPx(logicalHeight);

            wrapper.style.top = `${displayTop + ScheduleView.TIMELINE_TOP_PADDING_PX}px`;
            wrapper.style.height = `${displayHeight}px`;

            const widthPct = 100 / placement.columnCount;
            wrapper.style.width = `${widthPct}%`;
            wrapper.style.left = `${placement.column * widthPct}%`;

            if (placement.columnCount > 1) {
                console.debug('[ScheduleView][WidthDebug][render-before]', {
                    taskId: placement.task.id,
                    taskFile: placement.task.file,
                    startTime: placement.startTime,
                    column: placement.column,
                    columnCount: placement.columnCount,
                    widthPct,
                    inlineWidth: wrapper.style.width,
                    inlineLeft: wrapper.style.left,
                });
            }

            await this.renderTaskCard(wrapper, placement.task, true);

            if (placement.columnCount > 1) {
                const wrapperRect = wrapper.getBoundingClientRect();
                const containerRect = tasksContainer.getBoundingClientRect();
                const computedWrapper = getComputedStyle(wrapper);
                console.debug('[ScheduleView][WidthDebug][render-after]', {
                    taskId: placement.task.id,
                    startTime: placement.startTime,
                    column: placement.column,
                    columnCount: placement.columnCount,
                    computedWidth: computedWrapper.width,
                    computedLeft: computedWrapper.left,
                    wrapperPxWidth: wrapperRect.width,
                    containerPxWidth: containerRect.width,
                    widthRatio: containerRect.width > 0 ? wrapperRect.width / containerRect.width : null,
                });
            }
        }
    }

    private placeTasksOnGrid(tasks: TimedRenderableTask[], rows: GridRow[]): TaskPlacement[] {
        const clusters = this.buildOverlapClusters(tasks);
        const placements: TaskPlacement[] = [];

        for (const cluster of clusters) {
            const assignments = this.assignClusterColumns(cluster);
            const columnCount = assignments[0]?.columnCount ?? 1;

            if (columnCount > 1) {
                const clusterStart = Math.min(...cluster.map((task) => task.visualStartMinute));
                const clusterEnd = Math.max(...cluster.map((task) => task.visualEndMinute));
                console.debug('[ScheduleView][WidthDebug][cluster]', {
                    clusterStartMinute: clusterStart,
                    clusterEndMinute: clusterEnd,
                    clusterStartTime: this.visualMinuteToTime(clusterStart),
                    clusterEndTime: this.visualMinuteToTime(clusterEnd),
                    taskCount: cluster.length,
                    taskIds: cluster.map((task) => task.id),
                    columnCount,
                });
            }

            for (const assignment of assignments) {
                const task = assignment.task;
                const top = this.getTopForMinute(task.visualStartMinute, rows);
                const endTop = this.getTopForMinute(task.visualEndMinute, rows);
                const height = Math.max(1, endTop - top);

                placements.push({
                    task,
                    startTime: task.startTime ?? this.visualMinuteToTime(task.visualStartMinute),
                    top,
                    height,
                    column: assignment.column,
                    columnCount: assignment.columnCount,
                });

                if (assignment.columnCount > 1) {
                    console.debug('[ScheduleView][WidthDebug][placement]', {
                        taskId: task.id,
                        startTime: task.startTime,
                        column: assignment.column,
                        columnCount: assignment.columnCount,
                        top,
                        height,
                    });
                }
            }
        }

        return placements.sort((a, b) => {
            if (a.top !== b.top) return a.top - b.top;
            return a.column - b.column;
        });
    }

    private buildOverlapClusters(tasks: TimedRenderableTask[]): TimedRenderableTask[][] {
        const sorted = tasks.slice().sort((a, b) => {
            if (a.visualStartMinute !== b.visualStartMinute) {
                return a.visualStartMinute - b.visualStartMinute;
            }
            if (a.visualEndMinute !== b.visualEndMinute) {
                return b.visualEndMinute - a.visualEndMinute;
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        const clusters: TimedRenderableTask[][] = [];
        let currentCluster: TimedRenderableTask[] = [];
        let clusterMaxEnd = -1;

        for (const task of sorted) {
            if (currentCluster.length === 0) {
                currentCluster.push(task);
                clusterMaxEnd = task.visualEndMinute;
                continue;
            }

            // Timeline と同じ判定: start >= 現クラスタ最大end なら別クラスタ
            if (task.visualStartMinute >= clusterMaxEnd) {
                clusters.push(currentCluster);
                currentCluster = [task];
                clusterMaxEnd = task.visualEndMinute;
            } else {
                currentCluster.push(task);
                clusterMaxEnd = Math.max(clusterMaxEnd, task.visualEndMinute);
            }
        }

        if (currentCluster.length > 0) {
            clusters.push(currentCluster);
        }

        return clusters;
    }

    private assignClusterColumns(cluster: TimedRenderableTask[]): ClusteredTaskAssignment[] {
        const sorted = cluster.slice().sort((a, b) => {
            if (a.visualStartMinute !== b.visualStartMinute) {
                return a.visualStartMinute - b.visualStartMinute;
            }
            if (a.visualEndMinute !== b.visualEndMinute) {
                return b.visualEndMinute - a.visualEndMinute;
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        const columnEndMinutes: number[] = [];
        const assigned: Array<{ task: TimedRenderableTask; column: number }> = [];

        for (const task of sorted) {
            let column = -1;
            for (let i = 0; i < columnEndMinutes.length; i++) {
                if (task.visualStartMinute >= columnEndMinutes[i]) {
                    column = i;
                    break;
                }
            }

            if (column === -1) {
                column = columnEndMinutes.length;
                columnEndMinutes.push(task.visualEndMinute);
            } else {
                columnEndMinutes[column] = task.visualEndMinute;
            }

            assigned.push({ task, column });
        }

        const columnCount = Math.max(1, columnEndMinutes.length);
        return assigned.map((item) => ({
            task: item.task,
            column: item.column,
            columnCount,
        }));
    }

    private getTopForMinute(minute: number, rows: GridRow[]): number {
        if (rows.length === 0) {
            return 0;
        }

        if (minute <= rows[0].minute) {
            return rows[0].top;
        }

        for (let i = 0; i < rows.length - 1; i++) {
            const current = rows[i];
            const next = rows[i + 1];

            if (minute === current.minute) {
                return current.top;
            }

            if (minute < next.minute) {
                const gap = next.minute - current.minute;
                const ratio = gap > 0 ? (minute - current.minute) / gap : 0;
                return current.top + (ratio * current.height);
            }
        }

        return rows[rows.length - 1].top;
    }

    private renderNowLine(container: HTMLElement, rows: GridRow[], timelineHeight: number): void {
        if (rows.length === 0) {
            return;
        }

        const now = new Date();
        const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
        const nowMinute = this.timeToVisualMinute(timeStr);
        const firstMinute = rows[0].minute;
        const lastMinute = rows[rows.length - 1].minute;

        if (nowMinute < firstMinute || nowMinute > lastMinute) {
            return;
        }

        const topPx = this.getTopForMinute(nowMinute, rows) + ScheduleView.TIMELINE_TOP_PADDING_PX;
        if (topPx < 0 || topPx > timelineHeight) {
            return;
        }

        const nowLine = container.createDiv('timeline-now-line');
        nowLine.style.top = `${topPx}px`;
    }

    private calculateDurationMinutes(task: RenderableTask): number {
        if (!task.startDate || !task.startTime) {
            return 60;
        }

        const durationMs = DateUtils.getTaskDurationMs(
            task.startDate,
            task.startTime,
            task.endDate,
            task.endTime,
            this.plugin.settings.startHour
        );

        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return 60;
        }

        return Math.max(1, Math.round(durationMs / (1000 * 60)));
    }

    private timeToVisualMinute(timeStr: string): number {
        const [hour, minute] = timeStr.split(':').map(Number);
        let total = (hour * 60) + minute;
        const dayStart = this.getDayStartMinute();
        if (total < dayStart) {
            total += 24 * 60;
        }
        return total;
    }

    private visualMinuteToTime(minute: number): string {
        const dayMinutes = 24 * 60;
        const normalized = ((minute % dayMinutes) + dayMinutes) % dayMinutes;
        const hours = Math.floor(normalized / 60);
        const minutes = normalized % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    private clampMinute(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    private getDayStartMinute(): number {
        return this.plugin.settings.startHour * 60;
    }

    private categorizeTasksBySection(tasks: RenderableTask[], dateStr: string): CategorizedTasks {
        const categorized: CategorizedTasks = {
            allDay: [],
            timed: [],
            deadlines: [],
        };

        for (const task of tasks) {
            if (this.isDeadlineOnlyTaskOnDate(task, dateStr)) {
                categorized.deadlines.push(task);
                continue;
            }

            if (this.isTimedTask(task)) {
                const timedTask = this.toTimedRenderableTask(task);
                if (timedTask) {
                    categorized.timed.push(timedTask);
                    continue;
                }
            }

            categorized.allDay.push(task);
        }

        categorized.allDay.sort((a, b) => {
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        categorized.timed.sort((a, b) => {
            if (a.visualStartMinute !== b.visualStartMinute) {
                return a.visualStartMinute - b.visualStartMinute;
            }
            if (a.visualEndMinute !== b.visualEndMinute) {
                return a.visualEndMinute - b.visualEndMinute;
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        categorized.deadlines.sort((a, b) => {
            const aDeadline = a.deadline || '';
            const bDeadline = b.deadline || '';
            if (aDeadline !== bDeadline) {
                return aDeadline.localeCompare(bDeadline);
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        return categorized;
    }

    private toTimedRenderableTask(task: RenderableTask): TimedRenderableTask | null {
        if (!task.startTime) {
            return null;
        }

        const dayStart = this.getDayStartMinute();
        const dayEnd = dayStart + (ScheduleView.HOURS_PER_DAY * 60);
        const durationMinutes = this.calculateDurationMinutes(task);
        const rawStart = this.timeToVisualMinute(task.startTime);
        const rawEnd = rawStart + durationMinutes;

        const visualStartMinute = Math.max(dayStart, Math.min(dayEnd - 1, rawStart));
        const visualEndMinute = Math.max(visualStartMinute + 1, Math.min(dayEnd, rawEnd));

        return {
            ...task,
            visualStartMinute,
            visualEndMinute,
        };
    }

    private getTasksForDate(dateStr: string): RenderableTask[] {
        const result: RenderableTask[] = [];
        const allTasks = this.taskIndex.getTasks();
        for (const task of allTasks) {
            if (!this.filterMenu.isFileVisible(task.file)) {
                continue;
            }
            result.push(...this.getRenderableTasksForDate(task, dateStr));
        }
        return result;
    }

    private getRenderableTasksForDate(task: Task, dateStr: string): RenderableTask[] {
        if (this.isTimedTask(task)) {
            return this.getTimedTaskSegmentsForDate(task, dateStr);
        }

        if (this.isAllDayLikeTaskOnDate(task, dateStr)) {
            return [this.toRenderableTask(task)];
        }

        if (this.isDeadlineOnlyTaskOnDate(task, dateStr)) {
            return [this.toRenderableTask(task)];
        }

        return [];
    }

    private getTimedTaskSegmentsForDate(task: Task, dateStr: string): RenderableTask[] {
        if (!task.startDate || !task.startTime) {
            return [];
        }

        const startHour = this.plugin.settings.startHour;
        const segments: RenderableTask[] = [];

        if (shouldSplitTask(task, startHour)) {
            const [before, after] = splitTaskAtBoundary(task, startHour);
            const beforeDate = DateUtils.getVisualStartDate(before.startDate!, before.startTime!, startHour);
            const afterDate = DateUtils.getVisualStartDate(after.startDate!, after.startTime!, startHour);

            if (beforeDate === dateStr) {
                segments.push(this.toRenderableTask(before));
            }
            if (afterDate === dateStr) {
                segments.push(this.toRenderableTask(after));
            }
            return segments;
        }

        const visualDate = DateUtils.getVisualStartDate(task.startDate, task.startTime, startHour);
        if (visualDate === dateStr) {
            segments.push(this.toRenderableTask(task));
        }
        return segments;
    }

    private toRenderableTask(task: Task | RenderableTask): RenderableTask {
        const renderable = task as RenderableTask;
        return {
            ...task,
            id: task.id,
            originalTaskId: renderable.originalTaskId ?? task.id,
            isSplit: renderable.isSplit ?? false,
            splitSegment: renderable.splitSegment,
        };
    }

    private isTimedTask(task: Task): boolean {
        if (!task.startDate || !task.startTime) {
            return false;
        }
        return !DateUtils.isAllDayTask(
            task.startDate,
            task.startTime,
            task.endDate,
            task.endTime,
            this.plugin.settings.startHour
        );
    }

    private isAllDayLikeTaskOnDate(task: Task, dateStr: string): boolean {
        if (!task.startDate) {
            return false;
        }

        if (task.startTime && this.isTimedTask(task)) {
            return false;
        }

        if (task.endDate && task.endDate >= task.startDate) {
            return dateStr >= task.startDate && dateStr <= task.endDate;
        }

        return task.startDate === dateStr;
    }

    private isDeadlineOnlyTaskOnDate(task: Task, dateStr: string): boolean {
        if (!task.deadline) {
            return false;
        }
        if (task.startDate) {
            return false;
        }
        const deadlineDate = task.deadline.split('T')[0];
        return deadlineDate === dateStr;
    }

    private getFilterableFiles(dateStr: string): string[] {
        const files = new Set<string>();
        const allTasks = this.taskIndex.getTasks();

        for (const task of allTasks) {
            const renderableTasks = this.getRenderableTasksForDate(task, dateStr);
            if (renderableTasks.length > 0) {
                files.add(task.file);
            }
        }

        return Array.from(files).sort();
    }

    private async renderTaskCard(container: HTMLElement, task: RenderableTask, flowCard: boolean): Promise<void> {
        const wrapper = container.createDiv(flowCard ? 'schedule-flow-task-wrapper' : 'schedule-task-wrapper');
        const card = wrapper.createDiv('task-card');
        if (flowCard) {
            card.addClass('schedule-flow-task-card');
        }
        if (!task.startTime) {
            card.addClass('task-card--allday');
        }

        if (task.isSplit) {
            card.addClass('task-card--split');
            if (task.splitSegment) {
                card.addClass(`task-card--split-${task.splitSegment}`);
            }
        }

        this.applyTaskColor(card, task.file);
        this.applyTaskLinestyle(card, task.file);
        await this.taskRenderer.render(card, task, this, this.plugin.settings);
        this.menuHandler.addTaskContextMenu(card, task);
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

    private getFileLinestyle(filePath: string): string {
        return ViewUtils.getFileLinestyle(this.app, filePath, this.plugin.settings.frontmatterTaskKeys.linestyle);
    }

    private parseLocalDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    private applyTaskColor(el: HTMLElement, filePath: string): void {
        ViewUtils.applyFileColor(this.app, el, filePath, this.plugin.settings.frontmatterTaskKeys.color);
    }

    private applyTaskLinestyle(el: HTMLElement, filePath: string): void {
        ViewUtils.applyTaskLinestyle(el, this.getFileLinestyle(filePath));
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
