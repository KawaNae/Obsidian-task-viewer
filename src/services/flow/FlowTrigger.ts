import { type StatusDefinition, type Task, isCompleteStatusChar, isTvInline } from '../../types';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';

/**
 * Single source of truth for "does completing this task fire its flow
 * command". Replaces the removed per-parser isTriggerableStatus, which
 * hardcoded `statusChar !== ' '` and ignored the user's status settings.
 *
 * Fires only for:
 * - tv-inline tasks (read-only notations never fire),
 * - with an executable program (parse/check errors never fire — raw text
 *   is preserved and surfaced as diagnostics instead),
 * - whose status counts as complete per settings.statusDefinitions.
 */
export function canTriggerFlow(task: Task, statusDefinitions: StatusDefinition[]): boolean {
    return isTvInline(task)
        && !!task.flow?.program
        && isCompleteStatusChar(task.statusChar, statusDefinitions);
}

/**
 * Whether writing `after` over `before` completes a task: both are task
 * lines, `before` not complete and `after` complete per the settings. The
 * one answer to "was a task completed" for every operation that can fire a
 * flow — an editor transaction passes a line as it was and as it is, a
 * plugin write passes the line it wrote over (the one it matched against
 * the file) and the line it writes. Firing comes from this operation, never
 * from comparing two readings of a file.
 */
export function completes(before: string, after: string, statusDefinitions: StatusDefinition[]): boolean {
    const was = TaskLineClassifier.classify(before);
    if (was === null || isCompleteStatusChar(was.statusChar, statusDefinitions)) return false;
    const is = TaskLineClassifier.classify(after);
    return is !== null && isCompleteStatusChar(is.statusChar, statusDefinitions);
}

/** The `userEvent` marks of a transaction that is no operation in the editor. */
const NOT_OPERATIONS = ['set', 'undo', 'redo'];

/**
 * Whether an editor transaction, by its `userEvent` annotation, is an
 * operation in the editor: anything but `set` (a file loaded or synced into
 * the editor, a write to disk shown there), `undo` and `redo`, each with the
 * sub-marks after a `.`. A transaction with no mark is an operation. Only
 * an operation can complete a task and fire its flow.
 */
export function isOperation(userEvent: string | undefined): boolean {
    if (userEvent === undefined) return true;
    return !NOT_OPERATIONS.some(mark => userEvent === mark || userEvent.startsWith(`${mark}.`));
}
