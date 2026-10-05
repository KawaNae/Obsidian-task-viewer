import type { Task, ChildEntry } from '../../types';

/**
 * A task's children in the note's order: its child tasks (`childIds`) and
 * its own child lines (`childLines`), merged by the line each stands on.
 *
 * The extraction already gave every line of the note to one task at most
 * (`NoteTasks`: a task's child lines leave out its child tasks' subtrees and
 * its own `- ==>` lines), so this only merges; it takes nothing out.
 *
 * Pure: takes a `getTask` lookup so it composes with TaskReadService /
 * TaskIndex without coupling to either. A child the lookup does not hold
 * is left out.
 */
export function buildChildEntries(
    parent: Task,
    getTask: (id: string) => Task | undefined
): ChildEntry[] {
    const entries: ChildEntry[] = parent.childLines.map(line => ({ kind: 'line', line, bodyLine: line.bodyLine }));
    for (const taskId of parent.childIds) {
        const child = getTask(taskId);
        if (child) entries.push({ kind: 'task', taskId, bodyLine: child.line });
    }
    return entries.sort((a, b) => a.bodyLine - b.bodyLine);
}
