import type { Task } from '../types';
import type { TimerInstance } from './TimerInstance';
import type { TimerTaskResolver } from './TimerTaskResolver';

type SyncedTimer = Pick<TimerInstance, 'taskId' | 'taskFile' | 'taskOriginalText' | 'timerTargetId'>;

export interface TimerTaskRefresh {
    task: Task | undefined;
    /** True when `timer.taskId` / `timer.taskFile` were rewritten and need persisting. */
    rewritten: boolean;
}

/**
 * Find the timer's task, and re-point `timer.taskId` at it when the ID went stale.
 *
 * Runtime IDs live for one session, so after a restart the persisted `taskId`
 * names nothing; the resolver still finds the task by `timerTargetId` or its
 * text, and writing that answer back is what lets the name and colour follow
 * the task again. The direct lookup stays the fast path: this runs on every
 * tick, and the resolver walks every task in the vault.
 */
export function refreshTimerTask(
    timer: SyncedTimer,
    index: { getTask(id: string): Task | undefined },
    resolver: Pick<TimerTaskResolver, 'resolveTvInline'>
): TimerTaskRefresh {
    const byId = index.getTask(timer.taskId);
    if (byId) return { task: byId, rewritten: false };

    const resolved = resolver.resolveTvInline(timer);
    if (!resolved) return { task: undefined, rewritten: false };

    timer.taskId = resolved.id;
    timer.taskFile = resolved.file;
    return { task: resolved, rewritten: true };
}
