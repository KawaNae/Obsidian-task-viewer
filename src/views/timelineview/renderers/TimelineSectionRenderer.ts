import { Menu } from 'obsidian';
import { t } from '../../../i18n';
import type { DisplayTask } from '../../../types';
import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/menu/MenuHandler';
import { DateUtils } from '../../../utils/DateUtils';
import { TaskStyling } from '../../sharedUI/TaskStyling';
import { TaskLayout } from '../TaskLayout';
import { TaskCardRenderer } from '../../taskcard/TaskCardRenderer';
import { HandleManager } from '../HandleManager';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';


export class TimelineSectionRenderer {
    constructor(
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private handleManager: HandleManager,
        private taskRenderer: TaskCardRenderer,
        private getZoomLevel: () => number
    ) { }

    public render(container: HTMLElement, date: string, timedTasks: DisplayTask[]) {
        const startHour = this.plugin.settings.startHour;
        const renderableTasks = timedTasks;

        // Calculate layout for overlapping tasks
        const layout = TaskLayout.calculateTaskLayout(renderableTasks, date, startHour);

        renderableTasks.forEach(task => {
            if (!task.effectiveStartTime) return;

            const el = container.createDiv('task-card');
            if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');

            // Add split segment classes if applicable
            if (task.isSplit) {
                el.addClass('task-card--split');
                if (task.splitContinuesBefore) el.addClass('task-card--split-continues-before');
                if (task.splitContinuesAfter) el.addClass('task-card--split-continues-after');
                if (task.originalTaskId) {
                    el.dataset.splitOriginalId = task.originalTaskId;
                }
            }

            el.dataset.id = task.id;

            // Apply Color
            TaskStyling.applyTaskColor(el, task.color ?? null);
            TaskStyling.applyTaskLinestyle(el, task.linestyle ?? null);
            TaskStyling.applyReadOnly(el, task);

            // Calculate position
            let startMinutes = DateUtils.timeToMinutes(task.effectiveStartTime);
            let endMinutes: number;

            if (task.effectiveEndTime) {
                if (task.effectiveEndTime.includes('T')) {
                    // Full ISO: Calculate minutes relative to task.date's 00:00
                    // But wait, we need minutes relative to visual day start for rendering?
                    // No, render logic below uses (startMinutes - startHourMinutes).
                    // startMinutes is relative to 00:00 of the task's date (which is 'date' here).

                    // If endTime is next day, we need total minutes from start of 'date'.
                    const startDate = new Date(`${date}T00:00:00`);
                    const endDate = new Date(task.effectiveEndTime);
                    const diffMs = endDate.getTime() - startDate.getTime();
                    endMinutes = Math.floor(diffMs / 60000);
                } else {
                    endMinutes = DateUtils.timeToMinutes(task.effectiveEndTime);
                    // Handle wrap around midnight if needed (simple case)
                    if (endMinutes < startMinutes) {
                        endMinutes += 24 * 60;
                    }
                }
            } else {
                endMinutes = startMinutes + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
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
            const taskLayout = layout.get(task.id) || { width: 100, left: 0, zIndex: 1 };
            const widthFraction = taskLayout.width / 100;
            const leftFraction = taskLayout.left / 100;

            el.style.setProperty('--start-minutes', String(relativeStart));
            el.style.setProperty('--duration-minutes', String(duration));
            el.style.width = `calc((100% - 8px) * ${widthFraction})`;
            el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
            el.style.zIndex = String(taskLayout.zIndex);

            this.taskRenderer.render(el, task, this.plugin.settings);
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
        let touchStartX: number = 0;
        let touchStartY: number = 0;
        col.addEventListener('touchstart', (e) => {
            if (e.target === col && e.touches.length === 1) {
                const touch = e.touches[0];
                // Calculate offsetY relative to col
                const rect = col.getBoundingClientRect();
                const offsetY = touch.clientY - rect.top;
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;

                touchTimer = setTimeout(() => {
                    // Show context menu instead of directly opening modal
                    this.showEmptySpaceMenu(touchStartX, touchStartY, offsetY, date);
                }, this.plugin.settings.longPressThreshold);
            }
        }, { passive: true });

        col.addEventListener('touchend', () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
        }, { passive: true });

        col.addEventListener('touchmove', () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
        }, { passive: true });
    }

    private handleCreateTaskTrigger(offsetY: number, date: string) {
        // Calculate time from offsetY
        const zoomLevel = this.getZoomLevel();
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
            const taskLine = formatTaskLine(result);

            // date is the FILE date (visual column date)
            const [y, m, d] = date.split('-').map(Number);
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
        }, { startDate: taskDate, startTime: timeString }, { warnOnEmptyTask: true, dailyNoteDate: date, startHour: this.plugin.settings.startHour }).open();
    }

    /** Show context menu for empty space click */
    private showEmptySpaceMenu(x: number, y: number, offsetY: number, date: string) {
        const menu = new Menu();

        // Create new Task
        menu.addItem((item) => {
            item.setTitle(t('menu.createTaskForDailyNote'))
                .setIcon('plus')
                .onClick(() => this.handleCreateTaskTrigger(offsetY, date));
        });

        menu.addSeparator();

        // Open Countup (Daily Note)
        menu.addItem((item) => {
            item.setTitle(t('menu.openCountupForDailyNote'))
                .setIcon('clock')
                .onClick(() => this.openDailyNoteTimer(date, 'countup'));
        });

        // Open Pomodoro (Daily Note)
        menu.addItem((item) => {
            item.setTitle(t('menu.openPomodoroForDailyNote'))
                .setIcon('timer')
                .onClick(() => this.openDailyNoteTimer(date, 'pomodoro'));
        });

        menu.showAtPosition({ x, y });
    }

    /** Open timer for daily note */
    private openDailyNoteTimer(date: string, timerType: 'pomodoro' | 'countup') {
        const dailyNoteId = `daily-${date}`;
        const displayName = date;
        const widget = this.plugin.getTimerWidget();
        widget.startTimer({
            taskId: dailyNoteId,
            taskName: displayName,
            recordMode: 'child',
            timerType,
            autoStart: false
        });
    }
}
