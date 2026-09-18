import type { Task } from '../../../types';
import type { FileParseResult } from '../../parsing/FileParsePipeline';

/**
 * Rewrite every provisional ID in a parse result to its runtime ID, in one pass.
 *
 * The IDs are already baked into cross-references by the time parsing ends
 * (`TreeTaskExtractor` writes `parentId` and `childIds`; the pipeline re-parents
 * orphans onto the tv-file task), so swapping only `task.id` would leave dangling
 * `parentId`s. That failure is silent — a card just loses its children — which is
 * why the rewrite lives in one function instead of at each call site.
 *
 * Each object is visited exactly once and every lookup reads the old ID, so a
 * runtime ID that happens to equal some other task's provisional ID cannot be
 * mapped twice. IDs absent from `mapping` are left alone.
 */
export function applyIdentity(parsed: FileParseResult, mapping: Map<string, string>): void {
    let fmSeen = false;
    for (const task of parsed.tasks) {
        if (task === parsed.fmTask) fmSeen = true;
        rewriteTask(task, mapping);
    }

    // `fmTask` is normally the same object as `tasks[0]`, but an empty container is
    // returned without being pushed into `tasks` — then it still needs the rewrite,
    // since `wikilinkRefs` are keyed by `fmTask.id` downstream.
    if (parsed.fmTask && !fmSeen) {
        rewriteTask(parsed.fmTask, mapping);
    }
}

function rewriteTask(task: Task, mapping: Map<string, string>): void {
    const runtimeId = mapping.get(task.id);
    if (runtimeId !== undefined) task.id = runtimeId;

    if (task.parentId !== undefined) {
        const parentRuntimeId = mapping.get(task.parentId);
        if (parentRuntimeId !== undefined) task.parentId = parentRuntimeId;
    }

    for (let i = 0; i < task.childIds.length; i++) {
        const childRuntimeId = mapping.get(task.childIds[i]);
        if (childRuntimeId !== undefined) task.childIds[i] = childRuntimeId;
    }
}

/**
 * Throw if two tasks of one parse share a provisional ID.
 *
 * The mapping is keyed by that ID, so a shared one would quietly fold two tasks
 * onto one runtime ID. Provisional IDs are line-based and one line yields one
 * task, so this only fires if a parser starts emitting two tasks per line.
 */
export function assertUniqueProvisionalIds(tasks: Task[]): void {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const task of tasks) {
        if (seen.has(task.id)) shared.add(task.id);
        seen.add(task.id);
    }

    if (shared.size > 0) {
        throw new Error(`Provisional task IDs shared within one parse: ${[...shared].join(', ')}`);
    }
}

/**
 * Throw if any provisional ID survived the rewrite.
 *
 * A missed mapping breaks things quietly and far from its cause, so the scanner
 * stops at the store's door rather than committing a half-rewritten graph.
 */
export function assertNoProvisionalIds(tasks: Task[], isProvisional: (id: string) => boolean): void {
    const offenders = new Set<string>();
    for (const task of tasks) {
        if (isProvisional(task.id)) offenders.add(task.id);
        if (task.parentId !== undefined && isProvisional(task.parentId)) offenders.add(task.parentId);
        for (const childId of task.childIds) {
            if (isProvisional(childId)) offenders.add(childId);
        }
    }

    if (offenders.size > 0) {
        throw new Error(`Provisional task IDs reached the store: ${[...offenders].join(', ')}`);
    }
}
