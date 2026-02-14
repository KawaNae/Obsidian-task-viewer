import { ItemView, WorkspaceLeaf, Menu, setIcon } from 'obsidian';
import type { HoverParent } from 'obsidian';
import { TaskIndex } from '../services/core/TaskIndex';
import { TaskCardRenderer } from './taskcard/TaskCardRenderer';
import { Task, isCompleteStatusChar } from '../types';
import { shouldSplitTask, splitTaskAtBoundary, RenderableTask } from './utils/RenderableTaskUtils';
import { MenuHandler } from '../interaction/menu/MenuHandler';
import { DateUtils } from '../utils/DateUtils';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import TaskViewerPlugin from '../main';
import { ViewUtils, FileFilterMenu } from './ViewUtils';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../constants/hover';
import { TaskLinkInteractionManager } from './taskcard/TaskLinkInteractionManager';

export const VIEW_TYPE_SCHEDULE = 'schedule-view';

export class ScheduleView extends ItemView {
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;
    private taskRenderer: TaskCardRenderer;
    private menuHandler: MenuHandler;
    private linkInteractionManager: TaskLinkInteractionManager;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private filterMenu = new FileFilterMenu();

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.taskRenderer = new TaskCardRenderer(this.app, this.taskIndex, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.leaf,
        });
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app);
    }

    getViewType() {
        return VIEW_TYPE_SCHEDULE;
    }

    getDisplayText() {
        return 'Schedule View';
    }

    getIcon() {
        return 'calendar-days';
    }

    async onOpen() {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('schedule-view-container');

        // Initialize MenuHandler
        this.menuHandler = new MenuHandler(this.app, this.taskIndex, this.plugin);

        this.render();

        // Subscribe to changes
        this.unsubscribe = this.taskIndex.onChange(() => {
            this.render();
        });
    }

    async onClose() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }

    private render() {
        this.container.empty();

        this.renderToolbar();

        const scheduleContainer = this.container.createDiv('schedule-container');

        const { pastDates, futureDates, tasksByDate } = this.getTasksForSchedule();

        // Set view start date for MenuHandler (use today for ScheduleView)
        // For E, ED, D types in ScheduleView, use today as implicit start
        const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        this.menuHandler.setViewStartDate(today);

        // Render Past Dates (only if they have tasks)
        pastDates.forEach(date => {
            this.renderDateSection(scheduleContainer, date, tasksByDate[date], true);
        });

        // Render Future Dates (always render 14 days)
        futureDates.forEach(date => {
            this.renderDateSection(scheduleContainer, date, tasksByDate[date] || [], false);
        });
    }

    private renderToolbar() {
        const toolbar = this.container.createDiv('view-toolbar');

        // Filter Button
        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', 'Filter');
        filterBtn.setAttribute('title', 'Filter');
        filterBtn.onclick = (e) => {
            // Calculate relevant files (Past Incomplete + Future Any)
            const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
            const startHour = this.plugin.settings.startHour;
            const futureDates = new Set<string>();

            for (let i = 0; i < 14; i++) {
                const d = new Date(today);
                d.setDate(d.getDate() + i);
                futureDates.add(d.toISOString().split('T')[0]);
            }

            const allTasks = this.taskIndex.getTasks();
            const relevantFiles = new Set<string>();

            allTasks.forEach(task => {
                // Only timed tasks
                if (!task.startDate || !task.startTime) return;

                // Exclude all-day tasks
                const isAllDay = DateUtils.isAllDayTask(
                    task.startDate,
                    task.startTime,
                    task.endDate,
                    task.endTime,
                    startHour
                );
                if (isAllDay) return;

                // Calculate visual date
                const taskVisualDate = DateUtils.getVisualStartDate(
                    task.startDate,
                    task.startTime,
                    startHour
                );

                // Use settings-based completion check
                let isCompleted = isCompleteStatusChar(
                    task.statusChar || ' ',
                    this.plugin.settings.completeStatusChars
                );

                // Check child tasks
                if (isCompleted && task.childLines.length > 0) {
                    for (const childLine of task.childLines) {
                        const match = childLine.match(/^\s*-\s*\[(.)\]/);
                        if (match && !isCompleteStatusChar(match[1], this.plugin.settings.completeStatusChars)) {
                            isCompleted = false;
                            break;
                        }
                    }
                }

                if (taskVisualDate < today) {
                    if (!isCompleted) relevantFiles.add(task.file);
                } else if (futureDates.has(taskVisualDate)) {
                    relevantFiles.add(task.file);
                }
            });

            const distinctFiles = Array.from(relevantFiles).sort();

            this.filterMenu.showMenu(
                e,
                distinctFiles,
                (file) => this.getFileColor(file),
                () => this.render()
            );
        };
    }

    private renderDateSection(container: HTMLElement, date: string, tasks: Task[], isPast: boolean) {
        const dateSection = container.createDiv('schedule-date-section');
        if (isPast) {
            dateSection.addClass('is-past');
        }

        // Date Header with Day of Week
        const dateObj = this.parseLocalDate(date);
        const dayOfWeek = dateObj.toLocaleDateString('ja-JP', { weekday: 'short' });

        const header = dateSection.createEl('h3', { cls: 'schedule-date-header' });
        const linkTarget = DailyNoteUtils.getDailyNoteLinkTarget(this.app, dateObj);
        const linkLabel = DailyNoteUtils.getDailyNoteLabelForDate(this.app, dateObj);
        const dateLink = header.createEl('a', { cls: 'internal-link', text: linkLabel });
        dateLink.dataset.href = linkTarget;
        dateLink.setAttribute('href', linkTarget);
        dateLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });
        header.appendText(` (${dayOfWeek})`);

        this.linkInteractionManager.bind(header, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: this.leaf as HoverParent,
        }, { bindClick: false });

        // Add click listener to open daily note
        header.addEventListener('click', async () => {
            let file = DailyNoteUtils.getDailyNote(this.app, dateObj);
            if (!file) {
                file = await DailyNoteUtils.createDailyNote(this.app, dateObj);
            }
            if (file) {
                await this.app.workspace.getLeaf(false).openFile(file);
            }
        });

        // Task List
        const taskList = dateSection.createDiv('schedule-task-list');

        if (tasks.length === 0) {
            // Empty State
            const emptyCard = taskList.createDiv('schedule-empty-card');
            // emptyCard.setText('Empty'); // Removed text as per user request
        } else {
            // Sort tasks by time
            tasks.sort((a, b) => {
                // All-day tasks (no startTime) come first
                if (!a.startTime && b.startTime) return -1;
                if (a.startTime && !b.startTime) return 1;

                // If both have time, sort by time
                if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);

                return 0;
            });

            tasks.forEach(task => {
                const cardWrapper = taskList.createDiv('schedule-task-wrapper');
                const card = cardWrapper.createDiv('task-card');

                if (!task.startTime) {
                    card.addClass('task-card--allday');
                }

                // Add split task styling
                const renderable = task as RenderableTask;
                if (renderable.isSplit) {
                    card.addClass('task-card--split');
                    if (renderable.splitSegment) {
                        card.addClass(`task-card--split-${renderable.splitSegment}`);
                    }
                }

                // Apply color
                this.applyTaskColor(card, task.file);

                this.taskRenderer.render(card, task, this, this.plugin.settings);
                this.menuHandler.addTaskContextMenu(card, task);
            });
        }
    }

    private getTasksForSchedule(): { pastDates: string[], futureDates: string[], tasksByDate: Record<string, RenderableTask[]> } {
        const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        const startHour = this.plugin.settings.startHour;
        const allTasks = this.taskIndex.getTasks();
        const grouped: Record<string, RenderableTask[]> = {};
        const pastDates: Set<string> = new Set();

        // Generate future dates (Today + 14 days)
        const futureDates: string[] = [];
        for (let i = 0; i < 14; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            futureDates.push(d.toISOString().split('T')[0]);
        }

        // Helper to add task
        const addTask = (date: string, task: RenderableTask) => {
            if (!grouped[date]) grouped[date] = [];
            grouped[date].push(task);
        };

        allTasks.forEach(task => {
            // Only show timed tasks (Timeline column tasks)
            if (!task.startDate || !task.startTime) return;

            // Filter by visible files
            if (!this.filterMenu.isFileVisible(task.file)) {
                return;
            }

            // Exclude all-day tasks (24+ hours)
            const isAllDay = DateUtils.isAllDayTask(
                task.startDate,
                task.startTime,
                task.endDate,
                task.endTime,
                startHour
            );
            if (isAllDay) return;

            // Split tasks that cross visual day boundary
            const renderableTasks: RenderableTask[] = [];

            if (shouldSplitTask(task, startHour)) {
                const [before, after] = splitTaskAtBoundary(task, startHour);

                // Calculate visual dates for each segment
                const beforeVisualDate = DateUtils.getVisualStartDate(
                    before.startDate!,
                    before.startTime!,
                    startHour
                );
                const afterVisualDate = DateUtils.getVisualStartDate(
                    after.startDate!,
                    after.startTime!,
                    startHour
                );

                renderableTasks.push({ ...before, visualDate: beforeVisualDate } as RenderableTask & { visualDate: string });
                renderableTasks.push({ ...after, visualDate: afterVisualDate } as RenderableTask & { visualDate: string });
            } else {
                // No split needed: calculate visual date
                const visualDate = DateUtils.getVisualStartDate(
                    task.startDate,
                    task.startTime,
                    startHour
                );

                const renderable: RenderableTask = {
                    ...task,
                    id: task.id,
                    originalTaskId: task.id,
                    isSplit: false
                };

                renderableTasks.push({ ...renderable, visualDate } as RenderableTask & { visualDate: string });
            }

            // Determine completion status and add to appropriate date
            renderableTasks.forEach(renderable => {
                const visualDate = (renderable as any).visualDate;

                // Use settings-based completion check
                let isCompleted = isCompleteStatusChar(
                    task.statusChar || ' ',
                    this.plugin.settings.completeStatusChars
                );

                // Check child tasks
                if (isCompleted && task.childLines.length > 0) {
                    for (const childLine of task.childLines) {
                        const match = childLine.match(/^\s*-\s*\[(.)\]/);
                        if (match) {
                            const childStatus = match[1];
                            if (!isCompleteStatusChar(childStatus, this.plugin.settings.completeStatusChars)) {
                                isCompleted = false;
                                break;
                            }
                        }
                    }
                }

                // Add to past or future
                if (visualDate < today) {
                    // Past: only incomplete tasks
                    if (!isCompleted) {
                        addTask(visualDate, renderable);
                        pastDates.add(visualDate);
                    }
                } else {
                    // Future: check if in range
                    if (futureDates.includes(visualDate)) {
                        addTask(visualDate, renderable);
                    }
                }
            });
        });

        return {
            pastDates: Array.from(pastDates).sort(),
            futureDates: futureDates,
            tasksByDate: grouped
        };
    }

    private getFileColor(filePath: string): string | null {
        return ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterTaskKeys.color);
    }

    private parseLocalDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    private applyTaskColor(el: HTMLElement, filePath: string) {
        ViewUtils.applyFileColor(this.app, el, filePath, this.plugin.settings.frontmatterTaskKeys.color);
    }
}
