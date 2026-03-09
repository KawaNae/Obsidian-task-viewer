import type { DisplayTask } from '../../types';

export type CollapsibleSectionKey = 'allDay' | 'dueOnly';

export interface TimedDisplayTask extends DisplayTask {
    visualStartMinute: number;
    visualEndMinute: number;
}

export interface CategorizedTasks {
    allDay: DisplayTask[];
    timed: TimedDisplayTask[];
    dueOnly: DisplayTask[];
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
    task: TimedDisplayTask;
    startTime: string;
    top: number;
    height: number;
    column: number;
    columnCount: number;
}

export interface ClusteredTaskAssignment {
    task: TimedDisplayTask;
    column: number;
    columnCount: number;
}
