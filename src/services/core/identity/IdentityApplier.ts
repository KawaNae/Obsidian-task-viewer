import type { Task } from '../../../types';
import type { FileParseResult } from '../../parsing/FileParsePipeline';

/**
 * Rewrite every provisional ID in a parse result to its runtime ID, in one pass.
 *
 * The IDs are already baked into cross-references by the time parsing ends
 * (`TreeTaskExtractor` writes `parentId` and `childIds`), so swapping only
 * `task.id` would leave dangling
 * `parentId`s. That failure is silent — a card just loses its children — which is
 * why the rewrite lives in one function instead of at each call site.
 *
 * Each object is visited exactly once and every lookup reads the old ID, so a
 * runtime ID that happens to equal some other task's provisional ID cannot be
 * mapped twice. IDs absent from `mapping` are left alone.
 */
export function applyIdentity(parsed: FileParseResult, mapping: Map<string, string>): void {
    for (const task of parsed.tasks) {
        rewriteTask(task, mapping);
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

/**
 * Throw if one runtime ID is about to be handed to two rows of a file.
 *
 * What the store does with it is lose a task: it is keyed by ID, so the second
 * row overwrites the first and the file's tasks come out one short of the lines
 * on disk. The ledger keeps both positions but one entry, and no later scan
 * puts it back — the state is stable and wrong, and the task whose ID went
 * missing refuses every write with "not found" while its line sits there in
 * plain sight.
 *
 * Three things would have to fail for this to fire. Rung 0 refuses a claim that
 * names a row twice; a result that repeats an ID anyway is thrown out and the
 * file matched again with no claims at all (`matchWithoutRepeatedIds`); and the
 * ladder that then answers takes each previous row at most once. What is left
 * for this to catch is the ladder itself learning to repeat a row — which is
 * why it is an assertion and not a recovery. The recovery is upstream.
 */
export function assertDistinctRuntimeIds(entries: Array<{ runtimeId: string }>): void {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const entry of entries) {
        if (seen.has(entry.runtimeId)) shared.add(entry.runtimeId);
        seen.add(entry.runtimeId);
    }

    if (shared.size > 0) {
        throw new Error(`Runtime IDs shared by more than one row: ${[...shared].join(', ')}`);
    }
}
