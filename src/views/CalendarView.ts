import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { TaskIndex } from '../services/core/TaskIndex';
import { MenuHandler } from '../interaction/menu/MenuHandler';
import { TaskCardRenderer } from './taskcard/TaskCardRenderer';
import { Task, isCompleteStatusChar } from '../types';
import { DateUtils } from '../utils/DateUtils';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { TaskIdGenerator } from '../utils/TaskIdGenerator';
import { DragHandler } from '../interaction/drag/DragHandler';
import TaskViewerPlugin from '../main';
import { FileFilterMenu, ViewUtils } from './ViewUtils';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../constants/hover';
import { TaskLinkInteractionManager } from './taskcard/TaskLinkInteractionManager';
import { CalendarTaskModal } from './CalendarTaskModal';
import { VIEW_META_CALENDAR } from '../constants/viewRegistry';
import { HandleManager } from './timelineview/HandleManager';

export const VIEW_TYPE_CALENDAR = VIEW_META_CALENDAR.type;

interface CalendarTaskEntry {
    task: Task;
    segmentId: string;
    colStart: number;
    span: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
}

export class CalendarView extends ItemView {
    private readonly taskIndex: TaskIndex;
    private readonly plugin: TaskViewerPlugin;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly filterMenu = new FileFilterMenu();

    private menuHandler: MenuHandler;
    private dragHandler: DragHandler | null = null;
    private handleManager: HandleManager | null = null;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private currentMonth: Date;

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.taskRenderer = new TaskCardRenderer(this.app, this.taskIndex, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.leaf,
        });
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app);
        this.currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    }

    getViewType(): string {
        return VIEW_TYPE_CALENDAR;
    }

    getDisplayText(): string {
        return VIEW_META_CALENDAR.displayText;
    }

    getIcon(): string {
        return VIEW_META_CALENDAR.icon;
    }

    async setState(state: any, result: any): Promise<void> {
        if (state && typeof state.monthKey === 'string') {
            const monthMatch = state.monthKey.match(/^(\d{4})-(\d{2})$/);
            if (monthMatch) {
                const year = Number(monthMatch[1]);
                const month = Number(monthMatch[2]);
                if (month >= 1 && month <= 12) {
                    this.currentMonth = new Date(year, month - 1, 1);
                }
            }
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
        await this.render();
    }

    getState(): Record<string, unknown> {
        const visibleFiles = this.filterMenu.getVisibleFiles();
        return {
            monthKey: this.getMonthKey(this.currentMonth),
            filterFiles: visibleFiles ? Array.from(visibleFiles).sort() : null,
        };
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('calendar-view-container');

        this.menuHandler = new MenuHandler(this.app, this.taskIndex, this.plugin);
        this.handleManager = new HandleManager(this.container, this.taskIndex);
        this.dragHandler = new DragHandler(
            this.container,
            this.taskIndex,
            this.plugin,
            (taskId: string) => {
                this.handleManager?.selectTask(taskId);
            },
            () => {
                this.handleManager?.updatePositions();
            },
            () => this.getViewStartDateString()
        );

        this.container.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('.task-card__handle-btn')) {
                return;
            }
            if (!target.closest('.task-card')) {
                this.handleManager?.selectTask(null);
            }
        });

        await this.render();

        this.unsubscribe = this.taskIndex.onChange(() => {
            void this.render();
        });
    }

    async onClose(): Promise<void> {
        this.dragHandler?.destroy();
        this.dragHandler = null;
        this.handleManager = null;

        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    public refresh(): void {
        void this.render();
    }

    private async render(): Promise<void> {
        if (!this.container) {
            return;
        }

        this.container.empty();

        const toolbar = this.renderToolbar();
        const calendarHost = this.container.createDiv('calendar-grid');

        this.renderWeekdayHeader(calendarHost);

        const { startDate, endDate } = this.getCalendarDateRange();
        const rangeStartStr = DateUtils.getLocalDateString(startDate);
        const rangeEndStr = DateUtils.getLocalDateString(endDate);
        this.menuHandler.setViewStartDate(rangeStartStr);

        const allVisibleTasks = this.getVisibleTasksInRange(rangeStartStr, rangeEndStr);
        const body = calendarHost.createDiv('calendar-grid__body');

        let cursor = new Date(startDate);
        while (cursor <= endDate) {
            const weekRow = body.createDiv('calendar-week-row');
            const weekStartStr = DateUtils.getLocalDateString(cursor);
            weekRow.dataset.weekStart = weekStartStr;
            const weekDates: string[] = [];

            for (let i = 0; i < 7; i++) {
                const cellDate = new Date(cursor);
                const dateKey = DateUtils.getLocalDateString(cellDate);
                weekDates.push(dateKey);
                this.renderDateHeader(weekRow, cellDate, i + 1);
                cursor.setDate(cursor.getDate() + 1);
            }

            await this.renderWeekTasks(weekRow, weekDates, allVisibleTasks);
        }

        toolbar.dataset.range = `${rangeStartStr}:${rangeEndStr}`;

        const selectedTaskId = this.handleManager?.getSelectedTaskId();
        if (selectedTaskId) {
            this.handleManager?.selectTask(selectedTaskId);
        }
    }

    private renderToolbar(): HTMLElement {
        const toolbar = this.container.createDiv('view-toolbar calendar-toolbar');

        const prevBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(prevBtn, 'chevron-left');
        prevBtn.setAttribute('aria-label', 'Previous month');
        prevBtn.setAttribute('title', 'Previous month');
        prevBtn.addEventListener('click', () => this.navigateMonth(-1));

        const monthLabel = toolbar.createSpan({ cls: 'calendar-month-label' });
        monthLabel.setText(this.formatMonthLabel(this.currentMonth));

        const nextBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(nextBtn, 'chevron-right');
        nextBtn.setAttribute('aria-label', 'Next month');
        nextBtn.setAttribute('title', 'Next month');
        nextBtn.addEventListener('click', () => this.navigateMonth(1));

        const todayBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon view-toolbar__btn--today' });
        setIcon(todayBtn, 'circle');
        todayBtn.setAttribute('aria-label', 'Today');
        todayBtn.setAttribute('title', 'Today');
        todayBtn.addEventListener('click', () => {
            const today = new Date();
            this.currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            void this.app.workspace.requestSaveLayout();
            void this.render();
        });

        const spacer = toolbar.createDiv('view-toolbar__spacer');
        spacer.style.flex = '1';

        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', 'Filter files');
        filterBtn.setAttribute('title', 'Filter files');
        filterBtn.addEventListener('click', (event: MouseEvent) => {
            const { startDate, endDate } = this.getCalendarDateRange();
            const files = this.getFilterableFiles(
                DateUtils.getLocalDateString(startDate),
                DateUtils.getLocalDateString(endDate)
            );
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

        return toolbar;
    }

    private renderWeekdayHeader(container: HTMLElement): void {
        const header = container.createDiv('calendar-weekday-header');
        const weekdays = this.getWeekdayNames();
        weekdays.forEach((label) => {
            header.createEl('div', { cls: 'calendar-weekday-cell', text: label });
        });
    }

    private renderDateHeader(weekRow: HTMLElement, date: Date, colIndex: number): void {
        const header = weekRow.createDiv('calendar-date-header');
        const dateKey = DateUtils.getLocalDateString(date);
        const todayKey = DateUtils.getLocalDateString(new Date());

        header.style.gridColumn = `${colIndex}`;
        header.style.gridRow = '1';
        if (colIndex === 7) {
            header.addClass('is-last-col');
        }

        if (date.getFullYear() !== this.currentMonth.getFullYear() || date.getMonth() !== this.currentMonth.getMonth()) {
            header.addClass('is-outside-month');
        }
        if (dateKey === todayKey) {
            header.addClass('is-today');
        }

        const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(this.app, date);
        const dateLink = header.createEl('a', {
            cls: 'internal-link',
            text: String(date.getDate()),
        });
        dateLink.dataset.href = linkTarget;
        dateLink.setAttribute('href', linkTarget);
        dateLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });

        this.linkInteractionManager.bind(header, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.leaf as HoverParent,
        }, { bindClick: false });

        header.addEventListener('click', () => {
            void this.openOrCreateDailyNote(date);
        });
    }

    private async renderWeekTasks(weekRow: HTMLElement, weekDates: string[], allTasks: Task[]): Promise<void> {
        const entries = this.collectWeekTaskEntries(weekDates, allTasks);
        if (entries.length === 0) {
            return;
        }

        const maxTasksPerCell = Math.max(1, this.plugin.settings.calendarMaxTasksPerCell);
        const shownCountByDate = new Map<string, number>();
        const hiddenTasksByDate = new Map<string, Task[]>();
        weekDates.forEach((dateKey) => {
            shownCountByDate.set(dateKey, 0);
            hiddenTasksByDate.set(dateKey, []);
        });

        const tasksByDate = this.buildWeekTasksByDate(weekDates, entries);
        const tracks: number[] = [];
        let maxTrackIndex = -1;

        for (const entry of entries) {
            const coveredDates = weekDates.slice(entry.colStart - 1, entry.colStart - 1 + entry.span);
            const canRender = coveredDates.every((dateKey) => (shownCountByDate.get(dateKey) ?? 0) < maxTasksPerCell);

            if (!canRender) {
                for (const dateKey of coveredDates) {
                    hiddenTasksByDate.get(dateKey)?.push(entry.task);
                }
                continue;
            }

            let trackIndex = -1;
            for (let i = 0; i < tracks.length; i++) {
                if (entry.colStart > tracks[i]) {
                    trackIndex = i;
                    break;
                }
            }

            if (trackIndex === -1) {
                trackIndex = tracks.length;
                tracks.push(entry.colStart + entry.span - 1);
            } else {
                tracks[trackIndex] = entry.colStart + entry.span - 1;
            }

            const gridRow = trackIndex + 2;
            maxTrackIndex = Math.max(maxTrackIndex, trackIndex);
            await this.renderGridTask(weekRow, entry, gridRow);

            for (const dateKey of coveredDates) {
                shownCountByDate.set(dateKey, (shownCountByDate.get(dateKey) ?? 0) + 1);
            }
        }

        const moreRow = Math.max(2, maxTrackIndex + 3);
        for (let index = 0; index < weekDates.length; index++) {
            const dateKey = weekDates[index];
            const hiddenTasks = hiddenTasksByDate.get(dateKey) ?? [];
            if (hiddenTasks.length === 0) {
                continue;
            }

            const dedupedHiddenTasks: Task[] = [];
            const seenTaskIds = new Set<string>();
            for (const task of hiddenTasks) {
                if (!seenTaskIds.has(task.id)) {
                    dedupedHiddenTasks.push(task);
                    seenTaskIds.add(task.id);
                }
            }

            if (dedupedHiddenTasks.length === 0) {
                continue;
            }

            const moreBtn = weekRow.createEl('button', {
                cls: 'calendar-more-button',
                text: `+${dedupedHiddenTasks.length} more`,
            });
            moreBtn.style.gridColumn = `${index + 1}`;
            moreBtn.style.gridRow = `${moreRow}`;
            moreBtn.addEventListener('click', (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                const tasksForDate = tasksByDate.get(dateKey) ?? dedupedHiddenTasks;
                new CalendarTaskModal(
                    this.app,
                    tasksForDate,
                    dateKey,
                    this.taskRenderer,
                    this,
                    this.plugin.settings,
                    this.menuHandler
                ).open();
            });
        }
    }

    private buildWeekTasksByDate(weekDates: string[], entries: CalendarTaskEntry[]): Map<string, Task[]> {
        const tasksByDate = new Map<string, Task[]>();
        const seenByDate = new Map<string, Set<string>>();
        for (const dateKey of weekDates) {
            tasksByDate.set(dateKey, []);
            seenByDate.set(dateKey, new Set<string>());
        }

        for (const entry of entries) {
            const colEnd = entry.colStart + entry.span - 1;
            for (let col = entry.colStart; col <= colEnd; col++) {
                const dateKey = weekDates[col - 1];
                if (!dateKey) {
                    continue;
                }
                const seen = seenByDate.get(dateKey);
                if (!seen || seen.has(entry.task.id)) {
                    continue;
                }
                seen.add(entry.task.id);
                tasksByDate.get(dateKey)?.push(entry.task);
            }
        }

        return tasksByDate;
    }

    private collectWeekTaskEntries(weekDates: string[], allTasks: Task[]): CalendarTaskEntry[] {
        if (weekDates.length !== 7) {
            return [];
        }

        const weekStart = weekDates[0];
        const weekEnd = weekDates[6];
        const entries: CalendarTaskEntry[] = [];

        for (const task of allTasks) {
            const { effectiveStart, effectiveEnd } = this.getTaskDateRange(task);
            if (!effectiveStart) {
                continue;
            }

            const taskEnd = effectiveEnd || effectiveStart;
            if (effectiveStart > weekEnd || taskEnd < weekStart) {
                continue;
            }

            const clippedStart = effectiveStart < weekStart ? weekStart : effectiveStart;
            const clippedEnd = taskEnd > weekEnd ? weekEnd : taskEnd;

            const colStart = weekDates.indexOf(clippedStart) + 1;
            const colEnd = weekDates.indexOf(clippedEnd) + 1;
            const span = colEnd - colStart + 1;
            if (colStart < 1 || span < 1) {
                continue;
            }

            const isMultiday = this.isMultiDayTask(task);
            const isSplit = isMultiday && (effectiveStart < weekStart || taskEnd > weekEnd);
            const segmentId = isSplit
                ? TaskIdGenerator.makeSegmentId(task.id, clippedStart)
                : task.id;

            entries.push({
                task,
                segmentId,
                colStart,
                span,
                continuesBefore: isMultiday && effectiveStart < weekStart,
                continuesAfter: isMultiday && taskEnd > weekEnd,
            });
        }

        entries.sort((a, b) => {
            if (a.colStart !== b.colStart) return a.colStart - b.colStart;
            if (a.span !== b.span) return b.span - a.span;
            const fileDiff = a.task.file.localeCompare(b.task.file);
            if (fileDiff !== 0) return fileDiff;
            if (a.task.line !== b.task.line) return a.task.line - b.task.line;
            return a.task.id.localeCompare(b.task.id);
        });

        return entries;
    }

    private getVisibleTasksInRange(rangeStart: string, rangeEnd: string): Task[] {
        const allTasks = this.taskIndex.getTasks();
        return allTasks.filter((task) => {
            if (!this.plugin.settings.calendarShowCompleted && this.isTaskCompleted(task)) {
                return false;
            }
            if (!this.filterMenu.isFileVisible(task.file)) {
                return false;
            }

            const { effectiveStart, effectiveEnd } = this.getTaskDateRange(task);
            if (!effectiveStart) {
                return false;
            }
            const taskEnd = effectiveEnd || effectiveStart;
            return effectiveStart <= rangeEnd && taskEnd >= rangeStart;
        });
    }

    private getTaskDateRange(task: Task): { effectiveStart: string | null; effectiveEnd: string | null } {
        if (task.startDate) {
            if (task.startTime) {
                const visualDate = DateUtils.getVisualStartDate(
                    task.startDate,
                    task.startTime,
                    this.plugin.settings.startHour
                );
                const isAllDay = DateUtils.isAllDayTask(
                    task.startDate,
                    task.startTime,
                    task.endDate,
                    task.endTime,
                    this.plugin.settings.startHour
                );

                if (isAllDay && task.endDate && task.endDate >= task.startDate) {
                    return { effectiveStart: task.startDate, effectiveEnd: task.endDate };
                }
                return { effectiveStart: visualDate, effectiveEnd: visualDate };
            }

            const effectiveEnd = task.endDate && task.endDate >= task.startDate
                ? task.endDate
                : task.startDate;
            return { effectiveStart: task.startDate, effectiveEnd };
        }

        if (task.deadline) {
            const deadlineDate = task.deadline.split('T')[0];
            return { effectiveStart: deadlineDate, effectiveEnd: deadlineDate };
        }

        return { effectiveStart: null, effectiveEnd: null };
    }

    private isMultiDayTask(task: Task): boolean {
        if (!task.startDate) {
            return false;
        }
        if (task.startTime) {
            return DateUtils.isAllDayTask(
                task.startDate,
                task.startTime,
                task.endDate,
                task.endTime,
                this.plugin.settings.startHour
            ) && !!task.endDate && task.endDate > task.startDate;
        }

        return !!task.endDate && task.endDate > task.startDate;
    }

    private async renderGridTask(weekRow: HTMLElement, entry: CalendarTaskEntry, gridRow: number): Promise<void> {
        const isMultiday = this.isMultiDayTask(entry.task);

        if (isMultiday) {
            const barEl = weekRow.createDiv('task-card calendar-task-card calendar-multiday-bar');
            barEl.dataset.id = entry.segmentId;
            barEl.addClass('task-card--allday');
            barEl.addClass('task-card--multi-day');
            if (entry.continuesBefore || entry.continuesAfter) {
                barEl.dataset.splitOriginalId = entry.task.id;
            }
            barEl.style.gridColumn = `${entry.colStart} / span ${entry.span}`;
            barEl.style.gridRow = `${gridRow}`;

            if (entry.continuesBefore && entry.continuesAfter) {
                barEl.addClass('calendar-multiday-bar--middle');
            } else if (entry.continuesAfter) {
                barEl.addClass('calendar-multiday-bar--head');
            } else if (entry.continuesBefore) {
                barEl.addClass('calendar-multiday-bar--tail');
            }

            ViewUtils.applyFileColor(this.app, barEl, entry.task.file, this.plugin.settings.frontmatterTaskKeys.color);
            ViewUtils.applyFileLinestyle(this.app, barEl, entry.task.file, this.plugin.settings.frontmatterTaskKeys.linestyle);

            this.menuHandler.addTaskContextMenu(barEl, entry.task);
            await this.taskRenderer.render(barEl, entry.task, this, this.plugin.settings, { topRight: 'none' });
            return;
        }

        const card = weekRow.createDiv('task-card calendar-task-card');
        card.dataset.id = entry.task.id;
        if (!entry.task.startTime) {
            card.addClass('task-card--allday');
        }
        card.style.gridColumn = `${entry.colStart} / span ${entry.span}`;
        card.style.gridRow = `${gridRow}`;

        ViewUtils.applyFileColor(this.app, card, entry.task.file, this.plugin.settings.frontmatterTaskKeys.color);
        ViewUtils.applyFileLinestyle(this.app, card, entry.task.file, this.plugin.settings.frontmatterTaskKeys.linestyle);
        this.menuHandler.addTaskContextMenu(card, entry.task);
        await this.taskRenderer.render(card, entry.task, this, this.plugin.settings);
    }

    private isTaskCompleted(task: Task): boolean {
        let completed = isCompleteStatusChar(task.statusChar || ' ', this.plugin.settings.completeStatusChars);
        if (!completed || task.childLines.length === 0) {
            return completed;
        }

        for (const childLine of task.childLines) {
            const match = childLine.match(/^\s*-\s*\[(.)\]/);
            if (match && !isCompleteStatusChar(match[1], this.plugin.settings.completeStatusChars)) {
                completed = false;
                break;
            }
        }

        return completed;
    }

    private getFilterableFiles(rangeStart: string, rangeEnd: string): string[] {
        const files = new Set<string>();
        const tasks = this.taskIndex.getTasks();

        tasks.forEach((task) => {
            if (!this.plugin.settings.calendarShowCompleted && this.isTaskCompleted(task)) {
                return;
            }
            const { effectiveStart, effectiveEnd } = this.getTaskDateRange(task);
            if (!effectiveStart) {
                return;
            }
            const taskEnd = effectiveEnd || effectiveStart;
            if (effectiveStart <= rangeEnd && taskEnd >= rangeStart) {
                files.add(task.file);
            }
        });

        return Array.from(files).sort();
    }

    private getViewStartDateString(): string {
        const { startDate } = this.getCalendarDateRange();
        return DateUtils.getLocalDateString(startDate);
    }

    private getCalendarDateRange(): { startDate: Date; endDate: Date } {
        const monthStart = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth(), 1);
        const monthEnd = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + 1, 0);
        const startDate = this.getWeekStart(monthStart, this.plugin.settings.calendarWeekStartDay);
        const endDate = this.getWeekEnd(monthEnd, this.plugin.settings.calendarWeekStartDay);
        return { startDate, endDate };
    }

    private getWeekStart(date: Date, weekStartDay: 0 | 1): Date {
        const day = date.getDay();
        const diff = (day - weekStartDay + 7) % 7;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff);
    }

    private getWeekEnd(date: Date, weekStartDay: 0 | 1): Date {
        const day = date.getDay();
        const weekEndDay = (weekStartDay + 6) % 7;
        const diff = (weekEndDay - day + 7) % 7;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff);
    }

    private getWeekdayNames(): string[] {
        const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        if (this.plugin.settings.calendarWeekStartDay === 1) {
            return [...labels.slice(1), labels[0]];
        }
        return labels;
    }

    private formatMonthLabel(date: Date): string {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        return `${year}-${month}`;
    }

    private navigateMonth(offset: number): void {
        this.currentMonth = new Date(
            this.currentMonth.getFullYear(),
            this.currentMonth.getMonth() + offset,
            1
        );
        void this.app.workspace.requestSaveLayout();
        void this.render();
    }

    private getMonthKey(date: Date): string {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        return `${year}-${month}`;
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
