import type { DisplayTask, StatusDefinition } from '../../types';
import { isCompleteStatusChar } from '../../types';
import type { TaskReadService } from '../data/TaskReadService';

export type OverdueLevel = 'none' | 'past-end' | 'past-due';

/**
 * Whether `task` counts as complete: its status char, and every child task's
 * as displayed (`TaskReadService.getDisplayTask`).
 */
export function isTaskCompleted(
    task: DisplayTask,
    defs: StatusDefinition[],
    readService: Pick<TaskReadService, 'getDisplayTask'>,
): boolean {
    const completed = isCompleteStatusChar(task.statusChar || ' ', defs);
    if (!completed || task.childEntries.length === 0) {
        return completed;
    }

    for (const entry of task.childEntries) {
        if (entry.kind !== 'task') continue;
        const child = readService.getDisplayTask(entry.taskId);
        if (!child) continue;
        if (!isCompleteStatusChar(child.statusChar || ' ', defs)) return false;
    }

    return true;
}

/**
 * Whether an unfinished task is late at `now`: past its due (`dueMs ≤ now`),
 * else past the end of its span (`span.endMs ≤ now`). A segment of a split
 * task holds the span of its line, so it is judged as the whole task.
 */
export function getOverdueLevel(
    task: DisplayTask,
    defs: StatusDefinition[],
    readService: Pick<TaskReadService, 'getDisplayTask'>,
    now: number = Date.now(),
): OverdueLevel {
    if (isTaskCompleted(task, defs, readService)) return 'none';
    if (task.dueMs !== null && task.dueMs <= now) return 'past-due';
    if (task.span && task.span.endMs <= now) return 'past-end';
    return 'none';
}
