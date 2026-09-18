import type { ParserId } from '../../types';

/**
 * The syntax flavor a task is written in, derived from `parserId` for
 * filtering. Every task is a line in a note, so notation is the only axis
 * `parserId` carries; no field is added to Task.
 */

export type TaskNotation = 'taskviewer' | 'tasks' | 'dayplanner';

export const TASK_NOTATION_VALUES: readonly TaskNotation[] = ['taskviewer', 'tasks', 'dayplanner'];

export function getTaskNotation(parserId: ParserId): TaskNotation {
    switch (parserId) {
        case 'tasks-plugin':
            return 'tasks';
        case 'day-planner':
            return 'dayplanner';
        case 'tv-inline':
            return 'taskviewer';
    }
}
