import type { ParserId } from '../../types';

/**
 * Decomposes `parserId` into two orthogonal axes for filtering:
 * - kind: where the task is written (inline vs file)
 * - notation: which syntax flavor the task uses
 *
 * Single source of truth is `parserId`; both are derived on demand so no
 * new field is added to Task.
 */

export type TaskKind = 'inline' | 'file';
export type TaskNotation = 'taskviewer' | 'tasks' | 'dayplanner';

export const TASK_KIND_VALUES: readonly TaskKind[] = ['inline', 'file'];
export const TASK_NOTATION_VALUES: readonly TaskNotation[] = ['taskviewer', 'tasks', 'dayplanner'];

export function getTaskKind(parserId: ParserId): TaskKind {
    switch (parserId) {
        case 'tv-file':
            return 'file';
        case 'tv-inline':
        case 'tasks-plugin':
        case 'day-planner':
            return 'inline';
    }
}

export function getTaskNotation(parserId: ParserId): TaskNotation {
    switch (parserId) {
        case 'tasks-plugin':
            return 'tasks';
        case 'day-planner':
            return 'dayplanner';
        case 'tv-inline':
        case 'tv-file':
            return 'taskviewer';
    }
}
