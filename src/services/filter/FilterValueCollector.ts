import type { Task } from '../../types';
import { getTaskNotation } from './parserTaxonomy';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveTags, getEffectiveProperties,
} from '../data/EffectiveProperties';

/**
 * Collects available filter values from a set of tasks (for populating filter menus).
 * Reads effective (inheritance-merged) values so that offered candidates
 * always match what TaskFilterEngine evaluates against.
 */
export class FilterValueCollector {
    static collectTags(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            for (const tag of getEffectiveTags(task)) {
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
            const color = getEffectiveColor(task);
            if (color) set.add(color);
        }
        return Array.from(set).sort();
    }

    static collectLineStyles(tasks: Task[]): string[] {
        const set = new Set<string>();
        for (const task of tasks) {
            const linestyle = getEffectiveLinestyle(task);
            if (linestyle) set.add(linestyle);
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
            for (const key of Object.keys(getEffectiveProperties(task))) {
                set.add(key);
            }
        }
        return Array.from(set).sort();
    }

    static collectPropertyValuesForKey(tasks: Task[], key: string): string[] {
        if (!key) return [];
        const set = new Set<string>();
        for (const task of tasks) {
            const v = getEffectiveProperties(task)[key]?.value;
            if (v != null && v !== '') set.add(v);
        }
        return Array.from(set).sort();
    }
}
