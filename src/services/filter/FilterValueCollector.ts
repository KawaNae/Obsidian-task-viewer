import type { Task } from '../../types';

/**
 * Collects available filter values from a set of tasks (for populating filter menus).
 */
export class FilterValueCollector {
    static collectTags(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            for (const tag of task.tags) {
                set.add(tag);
            }
        }
        return Array.from(set).sort();
    }

    static collectFiles(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            set.add(task.file);
        }
        return Array.from(set).sort();
    }

    static collectStatuses(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            set.add(task.statusChar);
        }
        return Array.from(set).sort();
    }

    static collectColors(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            if (task.color) set.add(task.color);
        }
        return Array.from(set).sort();
    }

    static collectLineStyles(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            if (task.linestyle) set.add(task.linestyle);
        }
        return Array.from(set).sort();
    }
}
