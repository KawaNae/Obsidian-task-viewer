import { App, Menu } from 'obsidian';
import { Task } from '../types';
import { TaskIndex } from '../services/TaskIndex';
import TaskViewerPlugin from '../main';
import { ConfirmModal } from '../modals/ConfirmModal';

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
        // Standard Context Menu (Desktop/Mouse)
        el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.showContextMenu(event.pageX, event.pageY, task);
        });

        // Touch Handling for Long Press (Mobile/Touch Devices)
        let timer: number | null = null;
        let startX = 0;
        let startY = 0;

        el.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;

            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;

            timer = window.setTimeout(() => {
                // Long press detected
                timer = null;
                e.preventDefault(); // Prevent native context menu/selection
                this.showContextMenu(startX, startY, task);
            }, 500); // 500ms long press
        }, { passive: false });

        el.addEventListener('touchmove', (e) => {
            if (!timer) return;

            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;

            // If moved more than 10px, cancel long press
            if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) {
                clearTimeout(timer);
                timer = null;
            }
        }, { passive: true });

        el.addEventListener('touchend', () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });

        el.addEventListener('touchcancel', () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });
    }

    private showContextMenu(x: number, y: number, task: Task) {
        const menu = new Menu();

        // Open
        menu.addItem((item) => {
            item.setTitle('Open')
                .setIcon('document')
                .onClick(async () => {
                    await this.app.workspace.openLinkText(task.file, '', true);
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

        menu.addSeparator();

        // Delete
        menu.addItem((item) => {
            item.setTitle('Delete')
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
                    new ConfirmModal(
                        this.app,
                        'Delete Task',
                        'Are you sure you want to delete this task?',
                        async () => {
                            await this.taskIndex.deleteTask(task.id);
                        }
                    ).open();
                });
        });

        menu.showAtPosition({ x, y });
    }
}
