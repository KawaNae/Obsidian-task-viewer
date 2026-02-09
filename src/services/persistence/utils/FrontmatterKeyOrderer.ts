import type { TaskViewerSettings } from '../../../types';

/**
 * Utility class for ordering frontmatter keys in a consistent manner.
 * - Task keys (status, content, start, end, deadline) follow settings-defined order
 * - Habit keys follow settings.habits order
 * - Unknown keys preserve their original order
 */
export class FrontmatterKeyOrderer {
    constructor(private settings: TaskViewerSettings) {}

    private getTaskKeyOrder(): string[] {
        const keys = this.settings.frontmatterTaskKeys;
        return [keys.status, keys.content, keys.start, keys.end, keys.deadline];
    }

    /**
     * Returns the priority of a key for sorting.
     * Lower numbers = higher priority (appear first).
     */
    private getKeyPriority(key: string): number {
        // Task keys: priority 0-4
        const taskIndex = this.getTaskKeyOrder().indexOf(key);
        if (taskIndex !== -1) return taskIndex;

        // Habit keys: priority 100 + index in settings.habits
        const habitIndex = this.settings.habits.findIndex(h => h.name === key);
        if (habitIndex !== -1) return 100 + habitIndex;

        // Unknown keys: priority 1000
        return 1000;
    }

    /**
     * Sort keys according to the defined order.
     * Task keys → Habit keys (in settings order) → Other keys (preserve original order)
     *
     * @param keys - Array of keys to sort
     * @param originalIndices - Map of key to original index (for preserving unknown key order)
     */
    public sortKeys(keys: string[], originalIndices: Map<string, number>): string[] {
        return keys.slice().sort((a, b) => {
            const priorityA = this.getKeyPriority(a);
            const priorityB = this.getKeyPriority(b);

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            // Same priority (unknown keys) → preserve original order
            if (priorityA >= 1000) {
                const indexA = originalIndices.get(a) ?? 0;
                const indexB = originalIndices.get(b) ?? 0;
                return indexA - indexB;
            }

            // Task/Habit keys with same priority (should not happen)
            return a.localeCompare(b);
        });
    }
}
