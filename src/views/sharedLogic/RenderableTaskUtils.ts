/**
 * @deprecated Use DisplayTask from '../../types' and functions from '../../utils/DisplayTaskConverter' instead.
 * This file re-exports for backward compatibility during migration.
 */
import type { Task, DisplayTask } from '../../types';
import {
    shouldSplitDisplayTask,
    splitDisplayTaskAtBoundary,
    toDisplayTask,
} from '../../utils/DisplayTaskConverter';

/** @deprecated Use DisplayTask from '../../types' instead. */
export type RenderableTask = DisplayTask;

/** @deprecated Use shouldSplitDisplayTask from DisplayTaskConverter instead. */
export function shouldSplitTask(task: Task, startHour: number): boolean {
    const dt = toDisplayTask(task, startHour);
    return shouldSplitDisplayTask(dt, startHour);
}

/** @deprecated Use splitDisplayTaskAtBoundary from DisplayTaskConverter instead. */
export function splitTaskAtBoundary(task: Task, startHour: number): [DisplayTask, DisplayTask] {
    const dt = toDisplayTask(task, startHour);
    return splitDisplayTaskAtBoundary(dt, startHour);
}
