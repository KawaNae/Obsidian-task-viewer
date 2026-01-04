import { Component } from 'obsidian';

import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/MenuHandler';
import { DateUtils } from '../../../utils/DateUtils';
import { ViewUtils } from '../../ViewUtils';
import { TaskIndex } from '../../../services/TaskIndex';
import { TaskRenderer } from '../../TaskRenderer';
import { HandleManager } from '../HandleManager';
import { Task } from '../../../types';

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
            const tStart = t.startDate || viewStart;
            const tEnd = t.endDate || tStart;
            if (!(tStart <= viewEnd && tEnd >= viewStart)) return false;
            return DateUtils.isAllDayTask(tStart, t.startTime, t.endDate, t.endTime, startHour);
        });

        if (visibleFiles) {
            tasks = tasks.filter(t => visibleFiles.has(t.file));
        }

        tasks.sort((a, b) => {
            const startA = a.startDate || viewStart;
            const startB = b.startDate || viewStart;
            if (startA !== startB) return startA.localeCompare(startB);
            const endA = a.endDate || startA;
            const endB = b.endDate || startB;
            const durA = DateUtils.getDiffDays(startA, endA);
            const durB = DateUtils.getDiffDays(startB, endB);
            return durB - durA;
        });

        const tracks: string[] = [];

        tasks.forEach(task => {
            const tStart = task.startDate || viewStart;
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
}
