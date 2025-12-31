import { ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import { TaskIndex } from '../services/TaskIndex';
import { TaskRenderer } from './TaskRenderer';
import { Task } from '../types';
import { MenuHandler } from '../interaction/MenuHandler';
import { DateUtils } from '../utils/DateUtils';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { ColorUtils } from '../utils/ColorUtils';
import TaskViewerPlugin from '../main';
import { ViewUtils } from './ViewUtils';

export const VIEW_TYPE_SCHEDULE = 'schedule-view';

export class ScheduleView extends ItemView {
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;
    private taskRenderer: TaskRenderer;
    private menuHandler: MenuHandler;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private visibleFiles: Set<string> | null = null;

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.taskRenderer = new TaskRenderer(this.app, this.taskIndex);
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
        const toolbar = this.container.createDiv('task-viewer-toolbar');

        // Filter Button
        const filterBtn = toolbar.createEl('button', { text: 'Filter' });
        filterBtn.onclick = (e) => {
            const menu = new Menu();

            // Calculate relevant files (Past Incomplete + Future Any)
            const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
            const futureDates = new Set<string>();
            for (let i = 0; i < 14; i++) {
                const d = new Date(today);
                d.setDate(d.getDate() + i);
                futureDates.add(d.toISOString().split('T')[0]);
            }

            const allTasks = this.taskIndex.getTasks();
            const relevantFiles = new Set<string>();

            allTasks.forEach(task => {
                const taskDate = task.startDate;
                if (!taskDate) return;


                // Check completion status
                const isLineCompleted = (char: string) => ['x', 'X', '!', '-'].includes(char);
                const selfStatusChar = task.statusChar || ' ';
                let isCompleted = isLineCompleted(selfStatusChar);

                if (isCompleted && task.children.length > 0) {
                    for (const childLine of task.children) {
                        const match = childLine.match(/^\s*-\s*\[(.)\]/);
                        if (match && !isLineCompleted(match[1])) {
                            isCompleted = false;
                            break;
                        }
                    }
                }

                if (taskDate < today) {
                    if (!isCompleted) relevantFiles.add(task.file);
                } else if (futureDates.has(taskDate)) {
                    relevantFiles.add(task.file);
                }
            });

            const distinctFiles = Array.from(relevantFiles).sort();

            distinctFiles.forEach(file => {
                const isVisible = this.visibleFiles === null || this.visibleFiles.has(file);
                const color = this.getFileColor(file);
                const fileName = file.split('/').pop() || file;
                menu.addItem(item => {
                    item.setTitle(fileName)
                        .setChecked(isVisible)
                        .onClick(() => {
                            if (this.visibleFiles === null) {
                                this.visibleFiles = new Set(distinctFiles);
                            }

                            if (isVisible) {
                                this.visibleFiles.delete(file);
                            } else {
                                this.visibleFiles.add(file);
                            }

                            if (this.visibleFiles.size === distinctFiles.length) {
                                this.visibleFiles = null;
                            }

                            this.render();
                        });

                    item.setIcon('circle');
                    const iconEl = (item as any).dom.querySelector('.menu-item-icon');
                    if (iconEl && color) {
                        iconEl.style.color = color;
                        iconEl.style.fill = color;
                    }
                });
            });

            menu.showAtPosition({ x: e.pageX, y: e.pageY });
        };
    }

    private renderDateSection(container: HTMLElement, date: string, tasks: Task[], isPast: boolean) {
        const dateSection = container.createDiv('schedule-date-section');
        if (isPast) {
            dateSection.addClass('is-past');
        }

        // Date Header with Day of Week
        const dateObj = new Date(date);
        const dayOfWeek = dateObj.toLocaleDateString('ja-JP', { weekday: 'short' });
        const headerText = `${date} (${dayOfWeek})`;

        const header = dateSection.createEl('h3', { cls: 'schedule-date-header' });
        header.setText(headerText);

        // Add click listener to open daily note
        header.addEventListener('click', async () => {
            const dateObj = new Date(date);
            // Fix timezone offset for daily note creation
            // date string is YYYY-MM-DD, we want local midnight for that date
            const [y, m, d] = date.split('-').map(Number);
            dateObj.setFullYear(y, m - 1, d);
            dateObj.setHours(0, 0, 0, 0);

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
                    card.addClass('all-day');
                }

                // Apply color
                this.applyTaskColor(card, task.file);

                this.taskRenderer.render(card, task, this, this.plugin.settings);
                this.menuHandler.addTaskContextMenu(card, task);
            });
        }
    }

    private getTasksForSchedule(): { pastDates: string[], futureDates: string[], tasksByDate: Record<string, Task[]> } {
        const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        const allTasks = this.taskIndex.getTasks();
        const grouped: Record<string, Task[]> = {};
        const pastDates: Set<string> = new Set();

        // Generate future dates (Today + 14 days)
        const futureDates: string[] = [];
        for (let i = 0; i < 14; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            futureDates.push(d.toISOString().split('T')[0]);
        }

        // Helper to add task
        const addTask = (date: string, task: Task) => {
            if (!grouped[date]) grouped[date] = [];
            grouped[date].push(task);
        };

        allTasks.forEach(task => {
            const taskDate = task.startDate;
            if (!taskDate) return;

            // Filter by visible files
            if (this.visibleFiles && !this.visibleFiles.has(task.file)) {
                return;
            }

            // Determine if task is "completed" based on user rules
            // Completed: [x], [!], [-]
            // Incomplete: [ ], [>], [?]
            // AND all sub-tasks must be completed
            const isLineCompleted = (char: string) => ['x', 'X', '!', '-'].includes(char);

            const selfStatusChar = task.statusChar || ' ';
            let isCompleted = isLineCompleted(selfStatusChar);

            if (isCompleted && task.children.length > 0) {
                for (const childLine of task.children) {
                    // Check if line is a task
                    const match = childLine.match(/^\s*-\s*\[(.)\]/);
                    if (match) {
                        const childStatus = match[1];
                        if (!isLineCompleted(childStatus)) {
                            isCompleted = false;
                            break;
                        }
                    }
                }
            }

            if (taskDate < today) {
                // Past: Only incomplete
                if (!isCompleted) {
                    addTask(taskDate, task);
                    pastDates.add(taskDate);
                }
            } else {
                // Future: Check if in range
                if (futureDates.includes(taskDate)) {
                    addTask(taskDate, task);
                }
            }
        });

        return {
            pastDates: Array.from(pastDates).sort(),
            futureDates: futureDates,
            tasksByDate: grouped
        };
    }

    private getFileColor(filePath: string): string | null {
        return ViewUtils.getFileColor(this.app, filePath, this.plugin.settings.frontmatterColorKey);
    }

    private applyTaskColor(el: HTMLElement, filePath: string) {
        ViewUtils.applyFileColor(this.app, el, filePath, this.plugin.settings.frontmatterColorKey);
    }
}
