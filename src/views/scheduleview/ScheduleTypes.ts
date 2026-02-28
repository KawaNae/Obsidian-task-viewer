import type { RenderableTask } from '../sharedLogic/RenderableTaskUtils';

export type CollapsibleSectionKey = 'allDay' | 'deadlines';

export interface TimedRenderableTask extends RenderableTask {
    visualStartMinute: number;
    visualEndMinute: number;
}

export interface CategorizedTasks {
    allDay: RenderableTask[];
    timed: TimedRenderableTask[];
    deadlines: RenderableTask[];
}

export interface GridRow {
    time: string;
    minute: number;
    index: number;
    top: number;
    height: number;
}

export interface AdaptiveGridLayout {
    rows: GridRow[];
    totalHeight: number;
}

export interface TaskPlacement {
    task: TimedRenderableTask;
    startTime: string;
    top: number;
    height: number;
    column: number;
    columnCount: number;
}

export interface ClusteredTaskAssignment {
    task: TimedRenderableTask;
    column: number;
    columnCount: number;
}
