/**
 * Decomposes `parserId` into two orthogonal axes for filtering:
 * - kind: where the task is written (inline vs file)
 * - notation: which syntax flavor the task uses
 *
 * Single source of truth is `parserId`; both are derived on demand so no
 * new field is added to Task.
 */

export type TaskKind = 'inline' | 'file';
export type TaskNotation = 'taskviewer' | 'tasks' | 'dayplanner' | 'plain';

export const TASK_KIND_VALUES: readonly TaskKind[] = ['inline', 'file'];
export const TASK_NOTATION_VALUES: readonly TaskNotation[] = ['taskviewer', 'tasks', 'dayplanner', 'plain'];

export function getTaskKind(parserId: string): TaskKind {
    return parserId === 'frontmatter' ? 'file' : 'inline';
}

export function getTaskNotation(parserId: string): TaskNotation {
    switch (parserId) {
        case 'at-notation':
        case 'frontmatter':
            return 'taskviewer';
        case 'tasks-plugin':
            return 'tasks';
        case 'day-planner':
            return 'dayplanner';
        case 'plain':
            return 'plain';
        default:
            return 'plain';
    }
}
