import type { Task } from '../../types';
import { getTaskNotation } from './parserTaxonomy';
import { TagRule } from '../parsing/utils/TagRule';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveTags, getEffectiveProperties,
} from '../data/EffectiveProperties';

/**
 * Collects available filter values from a set of tasks (for populating filter menus).
 * Reads effective (inheritance-merged) values so that offered candidates
 * always match what TaskFilterEngine evaluates against.
 */
export class FilterValueCollector {
    /**
     * The tags of the tasks as Obsidian lists tags (`getTags`), so that
     * picking one is picking the tag the filter matches (case aside, and
     * with the tags below it): one per tag whatever its case, each tag above
     * one its `/` names too (`TagRule.withParents`). A tag is spelt as it is
     * most often written, counting a tag below it as a writing of it, and as
     * first met on a tie: `getTags`'s choice, over the tasks.
     */
    static collectTags(tasks: Task[]): string[] {
        const counts = new Map<string, number>();
        for (const task of tasks) {
            for (const tag of getEffectiveTags(task)) {
                for (const spelling of TagRule.withParents(tag)) {
                    counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
                }
            }
        }
        const chosen = new Map<string, { tag: string; most: number }>();
        for (const [tag, count] of counts) {
            const key = TagRule.key(tag);
            const known = chosen.get(key);
            if (!known || count > known.most) chosen.set(key, { tag, most: count });
        }
        return Array.from(chosen.values(), c => c.tag).sort();
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
