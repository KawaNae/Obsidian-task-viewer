import { Component, Menu } from 'obsidian';
import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/MenuHandler';
import { DateUtils } from '../../../utils/DateUtils';
import { ViewUtils } from '../../ViewUtils';
import { TaskLayout } from '../../../services/TaskLayout';
import { TaskIndex } from '../../../services/TaskIndex';
import { TaskRenderer } from '../../TaskRenderer';
import { HandleManager } from '../HandleManager';
import { CreateTaskModal } from '../../../modals/CreateTaskModal';


export class TimelineSectionRenderer {
    constructor(
        private taskIndex: TaskIndex,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private handleManager: HandleManager,
        private taskRenderer: TaskRenderer
    ) { }

    public render(container: HTMLElement, date: string, owner: Component, visibleFiles: Set<string> | null) {
        const startHour = this.plugin.settings.startHour;
        const zoomLevel = this.plugin.settings.zoomLevel;
        // Use getTasksForVisualDay, filter for timed tasks with duration < 24 hours
        let tasks = this.taskIndex.getTasksForVisualDay(date, startHour).filter(t => {
            if (!t.startTime) return false;
            // Only include tasks with duration < 24 hours
            const tStart = t.startDate || date;
            const isAllDay = DateUtils.isAllDayTask(tStart, t.startTime, t.endDate, t.endTime, startHour);
            return !isAllDay;
        });

        // Filter
        if (visibleFiles) {
            tasks = tasks.filter(t => visibleFiles.has(t.file));
        }

        // Calculate layout for overlapping tasks
        const layout = TaskLayout.calculateTaskLayout(tasks, date, startHour);

        tasks.forEach(task => {
            if (!task.startTime) return;

            const el = container.createDiv('task-card timed');
            if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');
            el.dataset.id = task.id;

            // Apply Color
            ViewUtils.applyFileColor(this.plugin.app, el, task.file, this.plugin.settings.frontmatterColorKey);

            // Calculate position
            let startMinutes = DateUtils.timeToMinutes(task.startTime);
            let endMinutes: number;

            if (task.endTime) {
                if (task.endTime.includes('T')) {
                    // Full ISO: Calculate minutes relative to task.date's 00:00
                    // But wait, we need minutes relative to visual day start for rendering?
                    // No, render logic below uses (startMinutes - startHourMinutes).
                    // startMinutes is relative to 00:00 of the task's date (which is 'date' here).

                    // If endTime is next day, we need total minutes from start of 'date'.
                    const startDate = new Date(`${date}T00:00:00`);
                    const endDate = new Date(task.endTime);
                    const diffMs = endDate.getTime() - startDate.getTime();
                    endMinutes = Math.floor(diffMs / 60000);
                } else {
                    endMinutes = DateUtils.timeToMinutes(task.endTime);
                    // Handle wrap around midnight if needed (simple case)
                    if (endMinutes < startMinutes) {
                        endMinutes += 24 * 60;
                    }
                }
            } else {
                endMinutes = startMinutes + 60;
            }

            // Adjust for startHour
            const startHourMinutes = startHour * 60;

            // If task is from next day (e.g. 02:00), add 24h
            if (startMinutes < startHourMinutes) {
                startMinutes += 24 * 60;
                endMinutes += 24 * 60;
            }

            // Calculate relative to visual start
            const relativeStart = startMinutes - startHourMinutes;
            const duration = endMinutes - startMinutes;

            // Apply layout
            const taskLayout = layout.get(task.id) || { width: 100, left: 0 };
            const widthFraction = taskLayout.width / 100;
            const leftFraction = taskLayout.left / 100;

            el.style.top = `${(relativeStart * zoomLevel) + 1}px`;
            el.style.height = `${(duration * zoomLevel) - 3}px`;
            el.style.width = `calc((100% - 8px) * ${widthFraction})`;
            el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
            el.style.setProperty('--initial-height', `${duration * zoomLevel}px`);

            this.taskRenderer.render(el, task, owner, this.plugin.settings);
            this.menuHandler.addTaskContextMenu(el, task);
        });
    }

    /** Adds click/context listeners for creating new tasks. */
    public addCreateTaskListeners(col: HTMLElement, date: string) {
        // Context Menu (Right Click)
        col.addEventListener('contextmenu', (e) => {
            // Prevent default context menu if clicking on empty space
            if (e.target === col) {
                e.preventDefault();
                this.showEmptySpaceMenu(e.pageX, e.pageY, e.offsetY, date);
            }
        });

        // Long Press (Touch)
        let touchTimer: NodeJS.Timeout | null = null;
        col.addEventListener('touchstart', (e) => {
            if (e.target === col && e.touches.length === 1) {
                const touch = e.touches[0];
                // Calculate offsetY relative to col
                const rect = col.getBoundingClientRect();
                const offsetY = touch.clientY - rect.top;

                touchTimer = setTimeout(() => {
                    this.handleCreateTaskTrigger(offsetY, date);
                }, 500); // 500ms long press
            }
        });

        col.addEventListener('touchend', () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
        });

        col.addEventListener('touchmove', () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
        });
    }

    private handleCreateTaskTrigger(offsetY: number, date: string) {
        // Calculate time from offsetY
        const zoomLevel = this.plugin.settings.zoomLevel;
        const startHour = this.plugin.settings.startHour;

        // offsetY is in pixels. 1 hour = 60 * zoomLevel pixels
        const minutesFromStart = offsetY / zoomLevel;

        // Add startHour offset
        const rawTotalMinutes = (startHour * 60) + minutesFromStart;
        let totalMinutes = rawTotalMinutes;

        // Normalize to 0-23 hours
        if (totalMinutes >= 24 * 60) {
            totalMinutes -= 24 * 60;
        }

        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.floor(totalMinutes % 60);

        // Round to nearest 5 minutes for cleaner times
        let roundedMinutes = Math.round(minutes / 5) * 5;
        let finalHours = hours;

        if (roundedMinutes === 60) {
            roundedMinutes = 0;
            finalHours += 1;
        }

        // Normalize hours again just in case
        if (finalHours >= 24) {
            finalHours -= 24;
        }

        // Format time HH:mm
        const timeString = `${finalHours.toString().padStart(2, '0')}:${roundedMinutes.toString().padStart(2, '0')}`;

        // Determine Task Date
        // If finalHours + 24 (effectively) was >= 24, it means it's next day
        // Wait, 'finalHours' is normalized 0-23. 
        // We can check totalMinutes vs 24*60
        // Or check rawTotalMinutes

        let taskDate = date;
        if (rawTotalMinutes >= 24 * 60) {
            // It's the next day
            const d = new Date(date);
            // Fix timezone for date calc
            const [y, m, day] = date.split('-').map(Number);
            d.setFullYear(y, m - 1, day);
            d.setDate(d.getDate() + 1);
            taskDate = DateUtils.getLocalDateString(d);
        }

        // Open Modal
        new CreateTaskModal(this.plugin.app, async (result) => {
            // date is the FILE date (visual column date)
            // taskDate is the actual date for the task (@YYYY-MM-DD)
            await this.taskIndex.addTaskToDailyNote(date, timeString, result, this.plugin.settings, taskDate);
        }).open();
    }

    /** Show context menu for empty space click */
    private showEmptySpaceMenu(x: number, y: number, offsetY: number, date: string) {
        const menu = new Menu();

        // Create new Task
        menu.addItem((item) => {
            item.setTitle('Create Task for Daily Note')
                .setIcon('plus')
                .onClick(() => this.handleCreateTaskTrigger(offsetY, date));
        });

        menu.addSeparator();

        // Open Pomodoro (Daily Note)
        menu.addItem((item) => {
            item.setTitle('🍅 Open Pomodoro for Daily Note')
                .setIcon('timer')
                .onClick(() => this.openDailyNoteTimer(date, 'pomodoro'));
        });

        // Open Timer (Daily Note)
        menu.addItem((item) => {
            item.setTitle('⏱️ Open Timer for Daily Note')
                .setIcon('clock')
                .onClick(() => this.openDailyNoteTimer(date, 'countup'));
        });

        menu.showAtPosition({ x, y });
    }

    /** Open timer for daily note */
    private openDailyNoteTimer(date: string, timerType: 'pomodoro' | 'countup') {
        const dailyNoteId = `daily-${date}`;
        const displayName = date;
        const widget = this.plugin.getTimerWidget();
        if (timerType === 'pomodoro') {
            widget.show(dailyNoteId, displayName);
        } else {
            widget.showCountup(dailyNoteId, displayName);
        }
    }
}
