import type { App, Component } from 'obsidian';
import type { TaskViewerSettings } from '../../../types';
import { TaskStyling } from '../../utils/TaskStyling';
import type { TaskCardRenderer } from '../../taskcard/TaskCardRenderer';
import type { MenuHandler } from '../../../interaction/menu/MenuHandler';
import type { GridRow, TaskPlacement, TimedRenderableTask } from '../ScheduleTypes';
import type { ScheduleGridCalculator } from '../utils/ScheduleGridCalculator';
import type { ScheduleOverlapLayout } from '../utils/ScheduleOverlapLayout';
import { toDisplayHeightPx, toDisplayTopPx } from '../../utils/TimelineCardPosition';
import type { RenderableTask } from '../../utils/RenderableTaskUtils';

export interface ScheduleTaskRendererOptions {
    app: App;
    component: Component;
    taskRenderer: TaskCardRenderer;
    menuHandler: MenuHandler;
    getSettings: () => TaskViewerSettings;
    gridCalculator: ScheduleGridCalculator;
    overlapLayout: ScheduleOverlapLayout;
    timelineTopPaddingPx: number;
}

export class ScheduleTaskRenderer {
    private readonly app: App;
    private readonly component: Component;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly menuHandler: MenuHandler;
    private readonly getSettings: () => TaskViewerSettings;
    private readonly gridCalculator: ScheduleGridCalculator;
    private readonly overlapLayout: ScheduleOverlapLayout;
    private readonly timelineTopPaddingPx: number;

    constructor(options: ScheduleTaskRendererOptions) {
        this.app = options.app;
        this.component = options.component;
        this.taskRenderer = options.taskRenderer;
        this.menuHandler = options.menuHandler;
        this.getSettings = options.getSettings;
        this.gridCalculator = options.gridCalculator;
        this.overlapLayout = options.overlapLayout;
        this.timelineTopPaddingPx = options.timelineTopPaddingPx;
    }

    async renderTaskCards(
        container: HTMLElement,
        placements: TaskPlacement[],
        timelineHeight: number
    ): Promise<void> {
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

            if (placement.columnCount > 1) {
                console.debug('[ScheduleView][WidthDebug][render-before]', {
                    taskId: placement.task.id,
                    taskFile: placement.task.file,
                    startTime: placement.startTime,
                    column: placement.column,
                    columnCount: placement.columnCount,
                    widthPct,
                    inlineWidth: wrapper.style.width,
                    inlineLeft: wrapper.style.left,
                });
            }

            await this.renderTaskCard(wrapper, placement.task, true);

            if (placement.columnCount > 1) {
                const wrapperRect = wrapper.getBoundingClientRect();
                const containerRect = tasksContainer.getBoundingClientRect();
                const computedWrapper = getComputedStyle(wrapper);
                console.debug('[ScheduleView][WidthDebug][render-after]', {
                    taskId: placement.task.id,
                    startTime: placement.startTime,
                    column: placement.column,
                    columnCount: placement.columnCount,
                    computedWidth: computedWrapper.width,
                    computedLeft: computedWrapper.left,
                    wrapperPxWidth: wrapperRect.width,
                    containerPxWidth: containerRect.width,
                    widthRatio: containerRect.width > 0 ? wrapperRect.width / containerRect.width : null,
                });
            }
        }
    }

    placeTasksOnGrid(tasks: TimedRenderableTask[], rows: GridRow[]): TaskPlacement[] {
        const clusters = this.overlapLayout.buildOverlapClusters(tasks);
        const placements: TaskPlacement[] = [];

        for (const cluster of clusters) {
            const assignments = this.overlapLayout.assignClusterColumns(cluster);
            const columnCount = assignments[0]?.columnCount ?? 1;

            if (columnCount > 1) {
                const clusterStart = Math.min(...cluster.map((task) => task.visualStartMinute));
                const clusterEnd = Math.max(...cluster.map((task) => task.visualEndMinute));
                console.debug('[ScheduleView][WidthDebug][cluster]', {
                    clusterStartMinute: clusterStart,
                    clusterEndMinute: clusterEnd,
                    clusterStartTime: this.gridCalculator.visualMinuteToTime(clusterStart),
                    clusterEndTime: this.gridCalculator.visualMinuteToTime(clusterEnd),
                    taskCount: cluster.length,
                    taskIds: cluster.map((task) => task.id),
                    columnCount,
                });
            }

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

                if (assignment.columnCount > 1) {
                    console.debug('[ScheduleView][WidthDebug][placement]', {
                        taskId: task.id,
                        startTime: task.startTime,
                        column: assignment.column,
                        columnCount: assignment.columnCount,
                        top,
                        height,
                    });
                }
            }
        }

        return placements.sort((a, b) => {
            if (a.top !== b.top) return a.top - b.top;
            return a.column - b.column;
        });
    }

    async renderTaskCard(container: HTMLElement, task: RenderableTask, flowCard: boolean): Promise<void> {
        const wrapper = container.createDiv(flowCard ? 'schedule-tasks__card-wrap' : 'schedule-section__task-wrap');
        const card = wrapper.createDiv('task-card');
        if (!task.startTime) {
            card.addClass('task-card--allday');
        }

        if (task.isSplit) {
            card.addClass('task-card--split');
            if (task.splitSegment) {
                card.addClass(`task-card--split-${task.splitSegment}`);
            }
        }

        TaskStyling.applyTaskColor(card, task.color ?? null);
        TaskStyling.applyTaskLinestyle(card, task.linestyle ?? 'solid');
        await this.taskRenderer.render(card, task, this.component, this.getSettings());
        this.menuHandler.addTaskContextMenu(card, task);
    }
}
