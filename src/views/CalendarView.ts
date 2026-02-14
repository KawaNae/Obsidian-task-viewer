import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { TaskIndex } from '../services/core/TaskIndex';
import { MenuHandler } from '../interaction/menu/MenuHandler';
import { TaskCardRenderer } from './taskcard/TaskCardRenderer';
import { Task, isCompleteStatusChar } from '../types';
import { DateUtils } from '../utils/DateUtils';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import TaskViewerPlugin from '../main';
import { FileFilterMenu, ViewUtils } from './ViewUtils';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../constants/hover';
import { TaskLinkInteractionManager } from './taskcard/TaskLinkInteractionManager';
import { CalendarTaskModal } from './CalendarTaskModal';

export const VIEW_TYPE_CALENDAR = 'calendar-view';

export class CalendarView extends ItemView {
    private readonly taskIndex: TaskIndex;
    private readonly plugin: TaskViewerPlugin;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly filterMenu = new FileFilterMenu();

    private menuHandler: MenuHandler;
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
        return 'Calendar View';
    }

    getIcon(): string {
        return 'calendar';
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

        const tasksByDate = this.getTasksByDate(rangeStartStr, rangeEndStr);
        const body = calendarHost.createDiv('calendar-grid__body');

        let cursor = new Date(startDate);
        while (cursor <= endDate) {
            const weekRow = body.createDiv('calendar-week-row');
            for (let i = 0; i < 7; i++) {
                const cellDate = new Date(cursor);
                const dateKey = DateUtils.getLocalDateString(cellDate);
                const tasks = tasksByDate.get(dateKey) ?? [];
                await this.renderDateCell(weekRow, cellDate, tasks);
                cursor.setDate(cursor.getDate() + 1);
            }
        }

        toolbar.dataset.range = `${rangeStartStr}:${rangeEndStr}`;
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

    private async renderDateCell(row: HTMLElement, date: Date, tasks: Task[]): Promise<void> {
        const cell = row.createDiv('calendar-date-cell');
        const dateKey = DateUtils.getLocalDateString(date);
        const todayKey = DateUtils.getLocalDateString(new Date());

        if (date.getFullYear() !== this.currentMonth.getFullYear() || date.getMonth() !== this.currentMonth.getMonth()) {
            cell.addClass('is-outside-month');
        }
        if (dateKey === todayKey) {
            cell.addClass('is-today');
        }

        const header = cell.createDiv('calendar-date-header');
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

        const taskList = cell.createDiv('calendar-task-list');
        if (tasks.length === 0) {
            return;
        }

        const maxTasks = Math.max(1, this.plugin.settings.calendarMaxTasksPerCell);
        const visibleTasks = tasks.slice(0, maxTasks);
        const renderPromises = visibleTasks.map((task) => this.renderTaskCard(taskList, task));
        await Promise.all(renderPromises);

        if (tasks.length > maxTasks) {
            const hiddenCount = tasks.length - maxTasks;
            const moreBtn = taskList.createEl('button', {
                cls: 'calendar-more-button',
                text: `+${hiddenCount} more`,
            });
            moreBtn.addEventListener('click', (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                new CalendarTaskModal(
                    this.app,
                    tasks,
                    dateKey,
                    this.taskRenderer,
                    this,
                    this.plugin.settings,
                    this.menuHandler
                ).open();
            });
        }
    }

    private async renderTaskCard(taskList: HTMLElement, task: Task): Promise<void> {
        const wrapper = taskList.createDiv('calendar-task-wrapper');
        const card = wrapper.createDiv('task-card');
        card.addClass('calendar-task-card');

        if (!task.startTime) {
            card.addClass('task-card--allday');
        }

        ViewUtils.applyFileColor(this.app, card, task.file, this.plugin.settings.frontmatterTaskKeys.color);
        ViewUtils.applyFileLinestyle(this.app, card, task.file, this.plugin.settings.frontmatterTaskKeys.linestyle);
        this.menuHandler.addTaskContextMenu(card, task);
        await this.taskRenderer.render(card, task, this, this.plugin.settings);
    }

    private getTasksByDate(rangeStart: string, rangeEnd: string): Map<string, Task[]> {
        const tasksByDate = new Map<string, Task[]>();
        const allTasks = this.taskIndex.getTasks();

        allTasks.forEach((task) => {
            if (!this.plugin.settings.calendarShowCompleted && this.isTaskCompleted(task)) {
                return;
            }
            if (!this.filterMenu.isFileVisible(task.file)) {
                return;
            }

            const dates = this.getCalendarDatesForTask(task, rangeStart, rangeEnd);
            dates.forEach((dateStr) => {
                const bucket = tasksByDate.get(dateStr);
                if (bucket) {
                    bucket.push(task);
                } else {
                    tasksByDate.set(dateStr, [task]);
                }
            });
        });

        for (const [date, tasks] of tasksByDate.entries()) {
            tasksByDate.set(date, this.sortTasksForCalendar(tasks));
        }

        return tasksByDate;
    }

    private getCalendarDatesForTask(task: Task, rangeStart: string, rangeEnd: string): string[] {
        if (task.startDate) {
            if (task.startTime) {
                const isAllDay = DateUtils.isAllDayTask(
                    task.startDate,
                    task.startTime,
                    task.endDate,
                    task.endTime,
                    this.plugin.settings.startHour
                );

                if (isAllDay && task.endDate && task.endDate >= task.startDate) {
                    return this.collectDateRange(task.startDate, task.endDate, rangeStart, rangeEnd);
                }

                const visualDate = DateUtils.getVisualStartDate(
                    task.startDate,
                    task.startTime,
                    this.plugin.settings.startHour
                );
                if (visualDate >= rangeStart && visualDate <= rangeEnd) {
                    return [visualDate];
                }
                return [];
            }

            if (task.endDate && task.endDate >= task.startDate) {
                return this.collectDateRange(task.startDate, task.endDate, rangeStart, rangeEnd);
            }

            if (task.startDate >= rangeStart && task.startDate <= rangeEnd) {
                return [task.startDate];
            }
            return [];
        }

        if (task.deadline) {
            const deadlineDate = task.deadline.split('T')[0];
            if (deadlineDate >= rangeStart && deadlineDate <= rangeEnd) {
                return [deadlineDate];
            }
        }

        return [];
    }

    private collectDateRange(start: string, end: string, rangeStart: string, rangeEnd: string): string[] {
        const clippedStart = start < rangeStart ? rangeStart : start;
        const clippedEnd = end > rangeEnd ? rangeEnd : end;
        if (clippedStart > clippedEnd) {
            return [];
        }

        const dates: string[] = [];
        let cursor = this.parseLocalDate(clippedStart);
        const endDate = this.parseLocalDate(clippedEnd);
        while (cursor <= endDate) {
            dates.push(DateUtils.getLocalDateString(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        return dates;
    }

    private sortTasksForCalendar(tasks: Task[]): Task[] {
        const startHour = this.plugin.settings.startHour;

        return tasks.slice().sort((a, b) => {
            const priorityDiff = this.getCalendarPriority(a, startHour) - this.getCalendarPriority(b, startHour);
            if (priorityDiff !== 0) return priorityDiff;

            if (a.startTime && b.startTime) {
                const timeDiff = a.startTime.localeCompare(b.startTime);
                if (timeDiff !== 0) return timeDiff;
            }

            const aDeadline = a.deadline || '';
            const bDeadline = b.deadline || '';
            if (aDeadline && bDeadline) {
                const deadlineDiff = aDeadline.localeCompare(bDeadline);
                if (deadlineDiff !== 0) return deadlineDiff;
            }

            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;

            return a.line - b.line;
        });
    }

    private getCalendarPriority(task: Task, startHour: number): number {
        if (task.startDate) {
            if (task.startTime) {
                return DateUtils.isAllDayTask(task.startDate, task.startTime, task.endDate, task.endTime, startHour)
                    ? 1
                    : 2;
            }

            if (task.endDate && task.endDate > task.startDate) {
                return 1;
            }
            return 3;
        }

        if (task.deadline) {
            return 4;
        }

        return 5;
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
            const dates = this.getCalendarDatesForTask(task, rangeStart, rangeEnd);
            if (dates.length > 0) {
                files.add(task.file);
            }
        });

        return Array.from(files).sort();
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

    private parseLocalDate(dateStr: string): Date {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
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
