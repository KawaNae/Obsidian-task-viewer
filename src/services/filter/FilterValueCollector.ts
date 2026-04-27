import type { Task } from '../../types';
import { getTaskNotation } from './parserTaxonomy';

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

    static collectNotations(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            set.add(getTaskNotation(task.parserId));
        }
        return Array.from(set).sort();
    }

    static collectPropertyKeys(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            if (!task.properties) continue;
            for (const key of Object.keys(task.properties)) {
                set.add(key);
            }
        }
        return Array.from(set).sort();
    }

    static collectPropertyValuesForKey(tasks: Task[], key: string): string[] {
        if (!key) return [];
        const set = new Set<string>();
        for (const task of tasks) {
            const v = task.properties?.[key]?.value;
            if (v != null && v !== '') set.add(v);
        }
        return Array.from(set).sort();
    }
}
