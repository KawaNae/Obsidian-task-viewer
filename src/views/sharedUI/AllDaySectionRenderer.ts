import { Component, Menu } from 'obsidian';

import TaskViewerPlugin from '../../main';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { DateUtils } from '../../utils/DateUtils';
import { TaskStyling } from './TaskStyling';
import { TaskIndex } from '../../services/core/TaskIndex';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { HandleManager } from '../timelineview/HandleManager';
import { Task } from '../../types';
import { CreateTaskModal, formatTaskLine } from '../../modals/CreateTaskModal';
import { computeGridLayout, GridTaskEntry } from '../sharedLogic/GridTaskLayout';
import { renderDeadlineArrow } from './DeadlineArrowRenderer';

export class AllDaySectionRenderer {
    constructor(
        private taskIndex: TaskIndex,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private handleManager: HandleManager,
        private taskRenderer: TaskCardRenderer,
        private getDaysToShow: () => number
    ) { }

    public render(container: HTMLElement, dates: string[], owner: Component, isTaskVisible: (task: Task) => boolean) {
        const viewStart = dates[0];
        const viewEnd = dates[dates.length - 1];
        const startHour = this.plugin.settings.startHour;

        // Filter for allDay tasks (AllDay-specific filtering)
        let tasks = this.taskIndex.getTasks().filter(t => {

            // Exclude D-type tasks (Deadline only)
            if (!t.startDate && !t.startTime && t.deadline) return false;

            // Use visual start date considering startHour
            const visualStart = t.startDate
                ? DateUtils.getVisualStartDate(t.startDate, t.startTime, startHour)
                : viewStart;
            const tEnd = t.endDate || visualStart;
            if (!(visualStart <= viewEnd && tEnd >= viewStart)) return false;

            // Filter for allDay tasks:
            // - Tasks without startTime (S-All, SD, ED, E, D types)
            // - Tasks with startTime but duration >= 24 hours
            // Exclude: SE/SED tasks with duration < 24 hours (those go to timeline)
            return DateUtils.isAllDayTask(
                t.startDate || visualStart, t.startTime, t.endDate, t.endTime, startHour
            );
        });

        tasks = tasks.filter(isTaskVisible);

        // Use shared layout engine
        const entries = computeGridLayout(tasks, {
            dates,
            getDateRange: (task) => {
                const effectiveStart = task.startDate
                    ? DateUtils.getVisualStartDate(task.startDate, task.startTime, startHour)
                    : viewStart;
                const effectiveEnd = task.endDate || effectiveStart;
                return { effectiveStart, effectiveEnd };
            },
            computeDeadlines: true,
        });

        // Grid offsets: col 1 = time axis, row 1 = padding
        const gridColOffset = 1;
        const gridRowOffset = 2;

        for (const entry of entries) {
            this.renderTaskCard(container, entry, owner, gridColOffset, gridRowOffset);

            if (entry.deadlineArrow) {
                renderDeadlineArrow(container, entry, gridRowOffset, gridColOffset);
            }
        }
    }

    private renderTaskCard(
        container: HTMLElement,
        entry: GridTaskEntry,
        owner: Component,
        gridColOffset: number,
        gridRowOffset: number
    ): void {
        const { task } = entry;

        const el = container.createDiv('task-card task-card--allday');
        if (entry.isMultiDay) {
            el.addClass('task-card--multi-day');
        }
        if (entry.continuesBefore && entry.continuesAfter) {
            el.addClass('calendar-multiday-bar--middle');
        } else if (entry.continuesAfter) {
            el.addClass('calendar-multiday-bar--head');
        } else if (entry.continuesBefore) {
            el.addClass('calendar-multiday-bar--tail');
        }
        if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');
        if (task.startDateInherited) el.addClass('task-card--inherited');
        el.dataset.id = task.id;

        TaskStyling.applyTaskColor(el, task.color ?? null);
        TaskStyling.applyTaskLinestyle(el, task.linestyle ?? null);

        this.taskRenderer.render(el, task, owner, this.plugin.settings, { topRight: 'none' });
        this.menuHandler.addTaskContextMenu(el, task);

        el.style.gridColumn = `${entry.colStart + gridColOffset} / span ${entry.span}`;
        el.style.gridRow = `${entry.trackIndex + gridRowOffset}`;
        el.style.zIndex = '10';
    }

    /** Add context menu listeners to AllDay section cell */
    public addEmptySpaceContextMenu(cell: HTMLElement, date: string) {
        cell.addEventListener('contextmenu', (e) => {
            if (e.target === cell) {
                e.preventDefault();
                this.showEmptySpaceMenu(e.pageX, e.pageY, date);
            }
        });
    }

    /** Show context menu for empty space click */
    private showEmptySpaceMenu(x: number, y: number, date: string) {
        const menu = new Menu();

        // Create Task (All-Day type)
        menu.addItem((item) => {
            item.setTitle('Create Task for Daily Note')
                .setIcon('plus')
                .onClick(() => this.handleCreateTask(date));
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
            item.setTitle('⏱️ Open Tracker for Daily Note')
                .setIcon('clock')
                .onClick(() => this.openDailyNoteTimer(date, 'countup'));
        });

        menu.showAtPosition({ x, y });
    }

    /** Create an all-day task for the specified date */
    private handleCreateTask(date: string) {
        new CreateTaskModal(this.plugin.app, async (result) => {
            const taskLine = formatTaskLine(result);
            const [y, m, d] = date.split('-').map(Number);
            const dateObj = new Date();
            dateObj.setFullYear(y, m - 1, d);
            dateObj.setHours(0, 0, 0, 0);

            const { DailyNoteUtils } = await import('../../utils/DailyNoteUtils');
            await DailyNoteUtils.appendLineToDailyNote(
                this.plugin.app,
                dateObj,
                taskLine,
                this.plugin.settings.dailyNoteHeader,
                this.plugin.settings.dailyNoteHeaderLevel
            );
        }, { startDate: date }, { warnOnEmptyTask: true }).open();
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
