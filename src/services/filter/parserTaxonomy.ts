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

export function getTaskKind(parserId: string): TaskKind {
    return parserId === 'frontmatter' ? 'file' : 'inline';
}

export function getTaskNotation(parserId: string): TaskNotation {
    switch (parserId) {
        case 'tasks-plugin':
            return 'tasks';
        case 'day-planner':
            return 'dayplanner';
        default:
            // at-notation, frontmatter, plain, and anything unknown are treated
            // as TaskViewer-owned (this plugin's parsers surface them).
            return 'taskviewer';
    }
}
