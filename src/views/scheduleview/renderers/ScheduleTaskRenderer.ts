import type { App } from 'obsidian';
import type { TaskViewerSettings } from '../../../types';
import { TaskStyling } from '../../sharedUI/TaskStyling';
import type { TaskCardRenderer } from '../../taskcard/TaskCardRenderer';
import { TIME_TOP_RIGHT } from '../../taskcard/TopRightFieldResolver';
import type { GridRow, TaskPlacement, TimedDisplayTask } from '../ScheduleTypes';
import type { ScheduleGridCalculator } from '../utils/ScheduleGridCalculator';
import type { ScheduleOverlapLayout } from '../utils/ScheduleOverlapLayout';
import { toDisplayHeightPx, toDisplayTopPx } from '../../../services/display/TimelineCardPosition';
import type { DisplayTask } from '../../../types';
import type { CardReconciler } from '../../sharedUI/CardReconciler';

export interface ScheduleTaskRendererOptions {
    app: App;
    taskRenderer: TaskCardRenderer;
    getSettings: () => TaskViewerSettings;
    gridCalculator: ScheduleGridCalculator;
    overlapLayout: ScheduleOverlapLayout;
    timelineTopPaddingPx: number;
}

export class ScheduleTaskRenderer {
    private readonly taskRenderer: TaskCardRenderer;
    private readonly getSettings: () => TaskViewerSettings;
    private readonly gridCalculator: ScheduleGridCalculator;
    private readonly overlapLayout: ScheduleOverlapLayout;
    private readonly timelineTopPaddingPx: number;

    constructor(options: ScheduleTaskRendererOptions) {
        this.taskRenderer = options.taskRenderer;
        this.getSettings = options.getSettings;
        this.gridCalculator = options.gridCalculator;
        this.overlapLayout = options.overlapLayout;
        this.timelineTopPaddingPx = options.timelineTopPaddingPx;
    }

    renderTaskCards(
        container: HTMLElement,
        placements: TaskPlacement[],
        timelineHeight: number,
        reconciler: CardReconciler,
    ): void {
        const tasksContainer = container.createDiv('schedule-tasks');
        tasksContainer.style.height = `${timelineHeight}px`;

        for (const placement of placements) {
            const wrapper = tasksContainer.createDiv('schedule-tasks__slot');
            wrapper.dataset.time = placement.startTime;
            const logicalTop = placement.top;
            const logicalHeight = placement.height;
            const displayTop = toDisplayTopPx(logicalTop);
            const displayHeight = toDisplayHeightPx(logicalHeight);

            wrapper.style.top = `${displayTop + this.timelineTopPaddingPx}px`;
            wrapper.style.height = `${displayHeight}px`;

            const widthPct = 100 / placement.columnCount;
            wrapper.style.width = `${widthPct}%`;
            wrapper.style.left = `${placement.column * widthPct}%`;

            this.renderTaskCard(wrapper, placement.task, true, reconciler);
        }
    }

    placeTasksOnGrid(tasks: TimedDisplayTask[], rows: GridRow[]): TaskPlacement[] {
        const clusters = this.overlapLayout.buildOverlapClusters(tasks);
        const placements: TaskPlacement[] = [];

        for (const cluster of clusters) {
            const assignments = this.overlapLayout.assignClusterColumns(cluster);

            for (const assignment of assignments) {
                const task = assignment.task;
                const top = this.gridCalculator.getTopForMinute(task.visualStartMinute, rows);
                const endTop = this.gridCalculator.getTopForMinute(task.visualEndMinute, rows);
                const height = Math.max(1, endTop - top);

                placements.push({
                    task,
                    startTime: task.startTime ?? this.gridCalculator.visualMinuteToTime(task.visualStartMinute),
                    top,
                    height,
                    column: assignment.column,
                    columnCount: assignment.columnCount,
                });

            }
        }

        return placements.sort((a, b) => {
            if (a.top !== b.top) return a.top - b.top;
            return a.column - b.column;
        });
    }

    renderTaskCard(container: HTMLElement, task: DisplayTask, flowCard: boolean, reconciler: CardReconciler): void {
        const wrapper = container.createDiv(flowCard ? 'schedule-tasks__card-wrap' : 'schedule-section__task-wrap');

        const key = { scope: flowCard ? 'flow' : 'section', name: task.id };
        const reused = reconciler.acquire(key, task);
        const card = reused ?? wrapper.createDiv('task-card');
        if (reused) wrapper.appendChild(reused);

        TaskStyling.applySplitClasses(card, task);
        const topRight = { mode: 'fields' as const, config: TIME_TOP_RIGHT };
        const options = flowCard ? { key, topRight } : { key, topRight, compact: true };
        this.taskRenderer.render(card, task, this.getSettings(), options);
    }
}
