import { Menu } from 'obsidian';

import TaskViewerPlugin from '../../main';
import { t } from '../../i18n';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { DateUtils } from '../../utils/DateUtils';
import { TaskStyling } from './TaskStyling';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { HandleManager } from '../timelineview/HandleManager';
import { DisplayTask } from '../../types';
import { CreateTaskModal, formatTaskLine } from '../../modals/CreateTaskModal';
import { computeGridLayout, GridTaskEntry } from '../sharedLogic/GridTaskLayout';
import { renderDueArrow } from './DueArrowRenderer';
import { splitTasks } from '../../services/display/TaskSplitter';
import { getTaskDateRange } from '../../services/display/VisualDateRange';

export class AllDaySectionRenderer {
    constructor(
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private handleManager: HandleManager,
        private taskRenderer: TaskCardRenderer,
        private getDaysToShow: () => number
    ) { }

    public render(container: HTMLElement, dates: string[], displayTasks: DisplayTask[]) {
        const viewStart = dates[0];
        const viewEnd = dates[dates.length - 1];
        const startHour = this.plugin.settings.startHour;

        // Filter for allDay tasks
        const tasks = displayTasks.filter(dt => {
            if (!dt.effectiveStartDate) return false;  // D type: excluded

            // Use visual start date considering startHour
            const range = getTaskDateRange(dt, startHour);
            const visualStart = range.effectiveStart || dt.effectiveStartDate;
            const tEnd = range.effectiveEnd || visualStart;
            if (!(visualStart <= viewEnd && tEnd >= viewStart)) return false;

            // Filter for allDay tasks:
            // - Tasks without startTime (S-All, SD, ED, E types)
            // - Tasks with startTime but duration >= 24 hours
            // Exclude: SE/SED tasks with duration < 24 hours (those go to timeline)
            return DateUtils.isAllDayTask(
                dt.effectiveStartDate, dt.effectiveStartTime, dt.effectiveEndDate, dt.effectiveEndTime, startHour
            );
        });

        // Pre-split at view boundaries (allDay tasks only need date-range split)
        const splitResult = splitTasks(tasks, { type: 'date-range', start: viewStart, end: viewEnd, startHour });

        // Use shared layout engine
        const entries = computeGridLayout(splitResult, {
            dates,
            getDateRange: (task) => {
                const dt = task as DisplayTask;
                if (!dt.effectiveStartDate) return null;
                const range = getTaskDateRange(dt, startHour);
                if (!range.effectiveStart) return null;
                return {
                    effectiveStart: range.effectiveStart,
                    effectiveEnd: range.effectiveEnd || range.effectiveStart,
                };
            },
            computeDueArrows: true,
        });

        // Grid offsets: col 1 = time axis, row 1 = padding
        const gridColOffset = 1;
        const gridRowOffset = 2;

        for (const entry of entries) {
            this.renderTaskCard(container, entry, gridColOffset, gridRowOffset);

            if (entry.dueArrow) {
                renderDueArrow(container, entry, {
                    gridRowOffset,
                    gridColOffset,
                });
            }
        }
    }

    private renderTaskCard(
        container: HTMLElement,
        entry: GridTaskEntry,
        gridColOffset: number,
        gridRowOffset: number
    ): void {
        const { task } = entry;

        const el = container.createDiv('task-card task-card--allday');
        if (entry.isMultiDay) {
            el.addClass('task-card--multi-day');
        }
        if (entry.continuesBefore) el.addClass('task-card--split-continues-before');
        if (entry.continuesAfter) el.addClass('task-card--split-continues-after');
        if (task.id === this.handleManager.getSelectedTaskId()) {
            console.log('[task-select] AllDaySectionRenderer initial .selected match', {
                taskId: task.id,
                originalTaskId: task.originalTaskId,
                file: task.file,
                line: task.line,
                content: task.content?.slice(0, 40),
            });
            el.addClass('selected');
        }
        el.dataset.id = task.id;

        TaskStyling.applyTaskColor(el, task.color ?? null);
        TaskStyling.applyTaskLinestyle(el, task.linestyle ?? null);
        TaskStyling.applyReadOnly(el, task);

        this.taskRenderer.render(el, task, this.plugin.settings, { topRight: 'none', compact: true });
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
            item.setTitle(t('menu.createTaskForDailyNote'))
                .setIcon('plus')
                .onClick(() => this.handleCreateTask(date));
        });

        menu.addSeparator();

        // Open Pomodoro (Daily Note)
        menu.addItem((item) => {
            item.setTitle(t('menu.openPomodoroForDailyNote'))
                .setIcon('timer')
                .onClick(() => this.openDailyNoteTimer(date, 'pomodoro'));
        });

        // Open Timer (Daily Note)
        menu.addItem((item) => {
            item.setTitle(t('menu.openCountupForDailyNote'))
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
        }, { startDate: date }, { warnOnEmptyTask: true, dailyNoteDate: date, startHour: this.plugin.settings.startHour }).open();
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
