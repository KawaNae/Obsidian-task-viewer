import { App, Menu } from 'obsidian';
import { Task } from '../types';
import { TaskIndex } from '../services/TaskIndex';
import TaskViewerPlugin from '../main';

export class MenuHandler {
    private app: App;
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;

    constructor(app: App, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        this.app = app;
        this.taskIndex = taskIndex;
        this.plugin = plugin;
    }

    addTaskContextMenu(el: HTMLElement, task: Task) {
        el.addEventListener('contextmenu', (event) => {
            event.preventDefault();

            const menu = new Menu();

            // Open File
            menu.addItem((item) => {
                item.setTitle('Open File')
                    .setIcon('document')
                    .onClick(async () => {
                        await this.app.workspace.openLinkText(task.file, '', true);
                    });
            });

            // Delete
            menu.addItem((item) => {
                item.setTitle('Delete')
                    .setIcon('trash')
                    .onClick(async () => {
                        await this.taskIndex.deleteTask(task.id);
                    });
            });

            // Convert
            const isAllDay = !task.startTime;
            menu.addItem((item) => {
                item.setTitle(isAllDay ? 'Convert to Timed' : 'Convert to All Day')
                    .setIcon('calendar-with-checkmark')
                    .onClick(async () => {
                        const updates: Partial<Task> = {};
                        if (isAllDay) {
                            // Convert to Timed (default to startHour)
                            const startHour = this.plugin.settings.startHour;
                            const h = startHour.toString().padStart(2, '0');
                            updates.startTime = `${h}:00`;
                            updates.endTime = `${(startHour + 1).toString().padStart(2, '0')}:00`;
                        } else {
                            // Convert to All Day
                            updates.startTime = undefined;
                            updates.endTime = undefined;
                        }
                        await this.taskIndex.updateTask(task.id, updates);
                    });
            });

            // Duplicate
            menu.addItem((item) => {
                item.setTitle('Duplicate')
                    .setIcon('copy')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTask(task.id);
                    });
            });

            menu.showAtPosition({ x: event.pageX, y: event.pageY });
        });
    }
}
