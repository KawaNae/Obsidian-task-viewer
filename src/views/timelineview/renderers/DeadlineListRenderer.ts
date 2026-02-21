import { Component, Menu } from 'obsidian';
import { Task, isCompleteStatusChar } from '../../../types';
import { TaskCardRenderer } from '../../taskcard/TaskCardRenderer';
import { DateUtils } from '../../../utils/DateUtils';
import { MenuHandler } from '../../../interaction/menu/MenuHandler';
import TaskViewerPlugin from '../../../main';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';
import { TaskStyling } from '../../utils/TaskStyling';

export class DeadlineListRenderer {
    // Preserve collapsed state across re-renders
    private collapsedGroups: Set<string> = new Set();
    private touchedGroups: Set<string> = new Set();
    private hydratedGroups: Set<string> = new Set();

    constructor(
        private taskRenderer: TaskCardRenderer,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler
    ) { }

    public render(container: HTMLElement, tasks: Task[], owner: Component, visibleFiles: Set<string> | null) {
        container.empty();
        container.addClass('deadline-list-container');
        this.hydratedGroups.clear();

        const settings = this.plugin.settings;
        const startHour = settings.startHour;
        const today = DateUtils.getVisualDateOfNow(startHour);
        const upcomingEnd = DateUtils.addDays(today, settings.upcomingDays);
        const completedDefaultCollapsed = !settings.expandCompletedInDeadlineList;

        // Apply file filter
        if (visibleFiles) {
            tasks = tasks.filter(t => visibleFiles.has(t.file));
        }

        // Classify into 4 groups
        const overdue: Task[] = [];
        const upcoming: Task[] = [];
        const notCompleted: Task[] = [];
        const completed: Task[] = [];

        tasks.forEach(task => {
            if (!task.deadline) return;

            const deadlineDate = task.deadline.split('T')[0];
            const isCompleted = isCompleteStatusChar(task.statusChar, settings.completeStatusChars);

            if (isCompleted) {
                completed.push(task);
            } else if (deadlineDate < today) {
                overdue.push(task);
            } else if (deadlineDate >= today && deadlineDate <= upcomingEnd) {
                upcoming.push(task);
            } else {
                notCompleted.push(task);
            }
        });

        // Sort each group by deadline ascending
        const sorter = (a: Task, b: Task) => {
            return (a.deadline || '').localeCompare(b.deadline || '');
        };

        overdue.sort(sorter);
        upcoming.sort(sorter);
        notCompleted.sort(sorter);
        completed.sort(sorter);

        // Render groups in order: OverDue → Upcoming → Not completed → Completed
        this.renderGroup(container, 'Overdue', overdue, 'is-overdue', owner);
        this.renderGroup(container, 'Upcoming', upcoming, 'is-upcoming', owner);
        this.renderGroup(container, 'Not completed', notCompleted, 'is-not-completed', owner);
        this.renderGroup(container, 'Completed', completed, 'is-completed', owner, {
            defaultCollapsed: completedDefaultCollapsed,
            lazyHydrate: true
        });

        // Context menu for empty space
        container.addEventListener('contextmenu', (event) => {
            if (event.target === container || (event.target as HTMLElement).closest('.deadline-group')) {
                if ((event.target as HTMLElement).closest('.task-card')) return;

                event.preventDefault();
                const menu = new Menu();
                menu.addItem((item) =>
                    item
                        .setTitle('Create Deadline Task')
                        .setIcon('plus')
                        .onClick(() => {
                            this.handleCreateDeadlineTask();
                        })
                );
                menu.showAtPosition({ x: event.pageX, y: event.pageY });
            }
        });
    }

    private handleCreateDeadlineTask() {
        const startHour = this.plugin.settings.startHour;
        const today = DateUtils.getVisualDateOfNow(startHour);
        const offset = this.plugin.settings.defaultDeadlineOffset || 0;
        const deadline = DateUtils.addDays(today, offset);

        new CreateTaskModal(this.plugin.app, async (result) => {
            const taskLine = formatTaskLine(result);

            const [y, m, d] = today.split('-').map(Number);
            const dateObj = new Date();
            dateObj.setFullYear(y, m - 1, d);
            dateObj.setHours(0, 0, 0, 0);

            const { DailyNoteUtils } = await import('../../../utils/DailyNoteUtils');
            await DailyNoteUtils.appendLineToDailyNote(
                this.plugin.app,
                dateObj,
                taskLine,
                this.plugin.settings.dailyNoteHeader,
                this.plugin.settings.dailyNoteHeaderLevel
            );
        }, { deadline }, { warnOnEmptyTask: true }).open();
    }

    private renderGroup(
        container: HTMLElement,
        title: string,
        tasks: Task[],
        className: string,
        owner: Component,
        options?: {
            defaultCollapsed?: boolean;
            lazyHydrate?: boolean;
        }
    ) {
        if (tasks.length === 0) return;

        const defaultCollapsed = options?.defaultCollapsed ?? false;
        const isCollapsed = this.touchedGroups.has(title)
            ? this.collapsedGroups.has(title)
            : defaultCollapsed;
        const lazyHydrate = options?.lazyHydrate === true;

        const groupEl = container.createDiv(`deadline-group ${className}`);
        if (isCollapsed) {
            groupEl.addClass('deadline-group--collapsed');
        }

        // Header: toggle icon + title + count
        const header = groupEl.createDiv('deadline-group-header');
        const toggle = header.createSpan({ text: isCollapsed ? '▶' : '▼', cls: 'deadline-group-toggle' });
        header.createSpan({ text: title, cls: 'deadline-group-title' });
        header.createSpan({ text: ` (${tasks.length})`, cls: 'deadline-count' });

        // Task list
        const listEl = groupEl.createDiv('deadline-group-list');
        if (!(lazyHydrate && isCollapsed)) {
            this.renderTasksIntoList(listEl, tasks, owner);
            if (lazyHydrate) {
                this.hydratedGroups.add(title);
            }
        }

        // Toggle click handler
        header.addEventListener('click', () => {
            const currentlyCollapsed = groupEl.classList.contains('deadline-group--collapsed');
            this.touchedGroups.add(title);

            if (currentlyCollapsed) {
                this.collapsedGroups.delete(title);
                groupEl.removeClass('deadline-group--collapsed');
                toggle.textContent = '▼';
                if (lazyHydrate && !this.hydratedGroups.has(title)) {
                    this.renderTasksIntoList(listEl, tasks, owner);
                    this.hydratedGroups.add(title);
                }
            } else {
                this.collapsedGroups.add(title);
                groupEl.addClass('deadline-group--collapsed');
                toggle.textContent = '▶';
            }
        });
    }

    private renderTasksIntoList(listEl: HTMLElement, tasks: Task[], owner: Component): void {
        tasks.forEach(task => {
            const card = listEl.createDiv('task-card task-card--deadline');

            TaskStyling.applyFileColor(this.plugin.app, card, task.file, this.plugin.settings.frontmatterTaskKeys.color);
            TaskStyling.applyFileLinestyle(this.plugin.app, card, task.file, this.plugin.settings.frontmatterTaskKeys.linestyle);

            this.taskRenderer.render(card, task, owner, this.plugin.settings, { topRight: 'deadline' });

            this.menuHandler.addTaskContextMenu(card, task);
        });
    }
}
