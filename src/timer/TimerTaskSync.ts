import type { Task } from '../types';
import type { TimerInstance } from './TimerInstance';

type SyncedTimer = Pick<TimerInstance, 'taskId' | 'taskFile' | 'timerTargetId'>;

export interface TimerTaskRefresh {
    task: Task | undefined;
    /** True when `timer.taskId` / `timer.taskFile` were rewritten and need persisting. */
    rewritten: boolean;
}

/**
 * Find the timer's task, and re-point `timer.taskId` at it when the name went stale.
 *
 * A name lasts one reading of its file: after a restart the persisted
 * `taskId` names nothing. A timer with a target anchor finds its row by the
 * anchor (`getTaskByAnchor`), the one place an anchor is looked up; writing
 * that answer back is what lets the name and colour follow the task again.
 * One given before a write of ours is followed to the row's name now
 * (`getTask`), and the timer takes it over. The direct lookup stays the fast
 * path: this runs on every render, and the anchor's lookup walks every task.
 */
export function refreshTimerTask(
    timer: SyncedTimer,
    index: { getTask(id: string): Task | undefined; getTaskByAnchor(file: string, anchor: string): Task | undefined },
): TimerTaskRefresh {
    const byId = index.getTask(timer.taskId);
    if (byId && byId.id === timer.taskId && (!timer.timerTargetId || byId.anchor === timer.timerTargetId)) {
        return { task: byId, rewritten: false };
    }

    const found = timer.timerTargetId ? index.getTaskByAnchor(timer.taskFile, timer.timerTargetId) : byId;
    if (!found) return { task: undefined, rewritten: false };

    timer.taskId = found.id;
    timer.taskFile = found.file;
    return { task: found, rewritten: true };
}
