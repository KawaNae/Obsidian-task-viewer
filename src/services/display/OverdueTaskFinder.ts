import type { DisplayTask, StatusDefinition } from '../../types';
import { isCompleteStatusChar } from '../../types';

/**
 * Find the oldest past visual start date among incomplete tasks.
 * Returns null when no overdue task exists.
 */
export function findOldestOverdueDate(
    displayTasks: DisplayTask[],
    visualToday: string,
    statusDefinitions: StatusDefinition[]
): string | null {
    let oldest: string | null = null;
    for (const dt of displayTasks) {
        if (!dt.effectiveStartDate) continue;
        if (isCompleteStatusChar(dt.statusChar, statusDefinitions)) continue;
        if (dt.effectiveStartDate >= visualToday) continue;
        if (!oldest || dt.effectiveStartDate < oldest) {
            oldest = dt.effectiveStartDate;
        }
    }
    return oldest;
}
