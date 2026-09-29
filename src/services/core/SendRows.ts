import type { Task } from '../../types';

/**
 * The rows a send takes of the ones it was asked for, each once: a row in
 * the subtree of another one asked for goes with that one's subtree, and is
 * not taken on its own (`v0.58-features.md`: 親と子を両方選んだら、親の部分木に
 * まとめる). In the order they stand, note by note: the order a send carries
 * them in, and so the order they land in.
 *
 * A row's subtree is the one the copy was read with (`Task.subtreeLines`),
 * the one the send is planned on.
 */
export function outermostRows<T extends { task: Task }>(rows: readonly T[]): T[] {
    const inOrder = [...rows].sort((a, b) => a.task.file.localeCompare(b.task.file) || a.task.line - b.task.line);
    const taken: T[] = [];
    for (const row of inOrder) {
        const holder = taken[taken.length - 1];
        if (holder && holder.task.file === row.task.file && row.task.line < holder.task.line + subtreeLength(holder.task)) continue;
        taken.push(row);
    }
    return taken;
}

function subtreeLength(task: Task): number {
    return task.subtreeLines?.length ?? 1;
}
