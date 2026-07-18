import { type StatusDefinition, type Task, isCompleteStatusChar, isTvInline } from '../../types';

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
