import { Component, Menu } from 'obsidian';

import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/MenuHandler';
import { DateUtils } from '../../../utils/DateUtils';
import { ViewUtils } from '../../ViewUtils';
import { TaskIndex } from '../../../services/TaskIndex';
import { TaskRenderer } from '../../TaskRenderer';
import { HandleManager } from '../HandleManager';
import { Task } from '../../../types';
import { CreateTaskModal } from '../../../modals/CreateTaskModal';

export class AllDaySectionRenderer {
    constructor(
        private taskIndex: TaskIndex,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private handleManager: HandleManager,
        private taskRenderer: TaskRenderer,
        private getDaysToShow: () => number
    ) { }

    public render(container: HTMLElement, dates: string[], owner: Component, visibleFiles: Set<string> | null) {
        const viewStart = dates[0];
        const viewEnd = dates[dates.length - 1];
        const startHour = this.plugin.settings.startHour;

        let tasks = this.taskIndex.getTasks().filter(t => {
            if (t.isFuture) return false;
            // Use visual start date considering startHour
            const visualStart = t.startDate
                ? DateUtils.getVisualStartDate(t.startDate, t.startTime, startHour)
                : viewStart;
            const tEnd = t.endDate || visualStart;
            if (!(visualStart <= viewEnd && tEnd >= viewStart)) return false;
            return DateUtils.isAllDayTask(t.startDate || visualStart, t.startTime, t.endDate, t.endTime, startHour);
        });

        if (visibleFiles) {
            tasks = tasks.filter(t => visibleFiles.has(t.file));
        }

        tasks.sort((a, b) => {
            const startA = a.startDate
                ? DateUtils.getVisualStartDate(a.startDate, a.startTime, startHour)
                : viewStart;
            const startB = b.startDate
                ? DateUtils.getVisualStartDate(b.startDate, b.startTime, startHour)
                : viewStart;
            if (startA !== startB) return startA.localeCompare(startB);
            const endA = a.endDate || startA;
            const endB = b.endDate || startB;
            const durA = DateUtils.getDiffDays(startA, endA);
            const durB = DateUtils.getDiffDays(startB, endB);
            return durB - durA;
        });

        const tracks: string[] = [];

        tasks.forEach(task => {
            // Use visual start date for positioning
            const tStart = task.startDate
                ? DateUtils.getVisualStartDate(task.startDate, task.startTime, startHour)
                : viewStart;
            const tEnd = task.endDate || tStart;

            // Calculate deadline line for arrow
            let deadlineLine: number | null = null;
            let isDeadlineClipped = false;
            if (task.deadline && task.deadline.match(/^\d{4}-\d{2}-\d{2}/)) {
                const deadlineDateStr = task.deadline.split('T')[0];
                const deadlineDiff = DateUtils.getDiffDays(viewStart, deadlineDateStr);
                const dlLine = deadlineDiff + 3;
                const gridMax = this.getDaysToShow() + 2;

                if (dlLine > gridMax) {
                    isDeadlineClipped = true;
                }
                deadlineLine = Math.min(dlLine, gridMax);

                const taskEndDiff = DateUtils.getDiffDays(viewStart, tEnd);
                const taskEndLine = taskEndDiff + 3;

                if (deadlineLine <= taskEndLine) {
                    deadlineLine = null;
                }
            }

            const tEndForCollision = deadlineLine
                ? DateUtils.addDays(viewStart, deadlineLine - 3)
                : tEnd;

            let trackIndex = -1;
            for (let i = 0; i < tracks.length; i++) {
                if (tStart > tracks[i]) {
                    trackIndex = i;
                    break;
                }
            }

            if (trackIndex === -1) {
                trackIndex = tracks.length;
                tracks.push(tEndForCollision);
            } else {
                tracks[trackIndex] = tEndForCollision;
            }

            // Render Task Card
            const el = container.createDiv('task-card task-card--allday');
            if (task.endDate && task.endDate !== tStart) {
                el.addClass('task-card--multi-day'); // Multi-day task marker
            }
            if (task.id === this.handleManager.getSelectedTaskId()) el.addClass('selected');
            el.dataset.id = task.id;

            ViewUtils.applyFileColor(this.plugin.app, el, task.file, this.plugin.settings.frontmatterColorKey);

            // Use TaskRenderer
            this.taskRenderer.render(el, task, owner, this.plugin.settings);

            this.menuHandler.addTaskContextMenu(el, task);

            // Positioning
            const diffStart = DateUtils.getDiffDays(viewStart, tStart);
            let colStart = 2 + diffStart;

            const durationArr = DateUtils.getDiffDays(tStart, tEnd) + 1;
            let span = durationArr;

            if (colStart < 2) {
                span -= (2 - colStart);
                colStart = 2;
            }

            const maxCol = 2 + this.getDaysToShow();
            if (colStart + span > maxCol) {
                span = maxCol - colStart;
            }

            if (span < 1) return;

            el.style.gridColumn = `${colStart} / span ${span}`;
            el.style.gridRow = `${trackIndex + 2}`; // +2 to leave padding row at top
            el.style.zIndex = '10';

            if (deadlineLine) {
                const taskEndLine = colStart + span;
                this.renderDeadlineArrow(container, task, trackIndex, taskEndLine, deadlineLine, isDeadlineClipped);
            }
        });
    }

    private renderDeadlineArrow(
        container: HTMLElement,
        task: Task,
        rowIndex: number,
        taskEndLine: number,
        deadlineLine: number,
        isClipped: boolean = false
    ) {
        const arrowEl = container.createDiv('deadline-arrow');
        arrowEl.dataset.taskId = task.id;
        arrowEl.style.gridRow = (rowIndex + 2).toString(); // +2 to match task offset
        arrowEl.style.gridColumnStart = taskEndLine.toString();
        arrowEl.style.gridColumnEnd = deadlineLine.toString();
        arrowEl.title = `Deadline: ${task.deadline}`;

        if (isClipped) {
            arrowEl.addClass('deadline-clipped');
        }
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
            item.setTitle('🍅 Start Pomodoro for Daily Note')
                .setIcon('timer')
                .onClick(() => this.openDailyNoteTimer(date, 'pomodoro'));
        });

        // Open Timer (Daily Note)
        menu.addItem((item) => {
            item.setTitle('⏱️ Start Timer for Daily Note')
                .setIcon('clock')
                .onClick(() => this.openDailyNoteTimer(date, 'countup'));
        });

        menu.showAtPosition({ x, y });
    }

    /** Create an all-day task for the specified date */
    private handleCreateTask(date: string) {
        new CreateTaskModal(this.plugin.app, async (content) => {
            // Create all-day task (S-All type: just date, no time)
            const taskLine = `- [ ] ${content} @${date}`;
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
        }).open();
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
