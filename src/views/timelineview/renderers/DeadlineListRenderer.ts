import { Component, Menu } from 'obsidian';
import { Task } from '../../../types';
import { TaskRenderer } from '../../TaskRenderer';
import { DateUtils } from '../../../utils/DateUtils';
import { MenuHandler } from '../../../interaction/MenuHandler';
import TaskViewerPlugin from '../../../main';
import { CreateTaskModal } from '../../../modals/CreateTaskModal';

export class DeadlineListRenderer {
    constructor(
        private taskRenderer: TaskRenderer,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler
    ) { }

    public render(container: HTMLElement, tasks: Task[], owner: Component) {
        container.empty();
        container.addClass('deadline-list-container');

        const startHour = this.plugin.settings.startHour;
        const today = DateUtils.getVisualDateOfNow(startHour);

        // Group tasks
        const overdue: Task[] = [];
        const todayTasks: Task[] = [];
        const upcoming: Task[] = [];

        tasks.forEach(task => {
            if (!task.deadline) return;

            if (task.deadline < today) {
                overdue.push(task);
            } else if (task.deadline === today) {
                todayTasks.push(task);
            } else {
                upcoming.push(task);
            }
        });

        // Sort overlapping tasks by deadline or file position
        const sorter = (a: Task, b: Task) => {
            if (a.deadline !== b.deadline) {
                return (a.deadline || '').localeCompare(b.deadline || '');
            }
            return 0;
            // Stable sort by original order or ID?
        };

        overdue.sort(sorter);
        todayTasks.sort(sorter);
        upcoming.sort(sorter);

        // Render Groups
        this.renderGroup(container, 'Overdue', overdue, 'is-overdue', owner);
        this.renderGroup(container, 'Today', todayTasks, 'is-today', owner);
        this.renderGroup(container, 'Upcoming', upcoming, 'is-upcoming', owner);

        // Add Context Menu for Empty Space
        container.addEventListener('contextmenu', (event) => {
            if (event.target === container || (event.target as HTMLElement).closest('.deadline-group')) {
                // Determine if we clicked on a card or handle (handled by card menu)
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
        new CreateTaskModal(this.plugin.app, async (content) => {
            const startHour = this.plugin.settings.startHour;
            const today = DateUtils.getVisualDateOfNow(startHour);
            // Default deadline: Today
            // Format: - [ ] content @>>YYYY-MM-DD
            const taskLine = `- [ ] ${content} @>>${today}`;

            // We append to Today's Daily Note for now, as a safe default.
            // Or maybe separate backlog file? But plugin is Daily Note focused.
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
        }).open();
    }


    private renderGroup(container: HTMLElement, title: string, tasks: Task[], className: string, owner: Component) {
        if (tasks.length === 0) return;

        const groupEl = container.createDiv(`deadline-group ${className}`);
        const header = groupEl.createEl('h4', { text: title, cls: 'deadline-group-header' });
        header.createSpan({ text: ` (${tasks.length})`, cls: 'deadline-count' });

        const listEl = groupEl.createDiv('deadline-group-list');

        tasks.forEach(task => {
            const card = listEl.createDiv('task-card deadline-task-card');

            // Add deadline indicator visual if needed, but TaskRenderer handles content
            // Maybe add explicit deadline label? TaskRenderer usually shows icon+date?

            this.taskRenderer.render(card, task, owner, this.plugin.settings);
            // TaskRenderer signature: render(container, task, view?, settings?)
            // View is used for refresh(). Passing null might be risky if checkbox change tries to refresh view.
            // But TaskRenderer's `handleCheckboxClick` uses `view.refresh()` if provided.

            this.menuHandler.addTaskContextMenu(card, task);
        });
    }
}
