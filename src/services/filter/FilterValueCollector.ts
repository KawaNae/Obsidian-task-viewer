import type { Task } from '../../types';
import { PropertyKey } from '../parsing/utils/PropertyKey';
import { PropertyValues } from '../parsing/utils/PropertyValues';
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

    /**
     * The property keys of the tasks, one per property whatever its case
     * (`PropertyKey`), spelt as the tasks most often show it, and as first
     * met on a tie: the tags' choice ({@link collectTags}).
     */
    static collectPropertyKeys(tasks: Task[]): string[] {
        const counts = new Map<string, number>();
        for (const task of tasks) {
            for (const { key } of Object.values(getEffectiveProperties(task))) {
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
        const chosen = new Map<string, { key: string; most: number }>();
        for (const [key, count] of counts) {
            const folded = PropertyKey.fold(key);
            const known = chosen.get(folded);
            if (!known || count > known.most) chosen.set(folded, { key, most: count });
        }
        return Array.from(chosen.values(), c => c.key).sort();
    }

    /**
     * The values the hub's field for the property `key` offers, its case
     * aside: each as a line spells it (`PropertyValues.spelling`), since the
     * field holds what is written (`"123"` a text, `123` a number, two
     * values); each item of a list on its own, as a list's item is written
     * alone; no value left out, as an empty field writes none.
     */
    static collectPropertySpellingsForKey(tasks: Task[], key: string): string[] {
        if (!key) return [];
        const set = new Set<string>();
        for (const task of tasks) {
            const value = PropertyKey.get(getEffectiveProperties(task), key)?.value;
            if (!value || value.type === 'null') continue;
            for (const item of value.type === 'list' ? value.items : [value]) {
                const spelled = PropertyValues.spelling(item);
                if (spelled !== '') set.add(spelled);
            }
        }
        return Array.from(set).sort();
    }

    /**
     * The values a property condition on `key` can be given to find the
     * tasks that show them, its case aside: each item of a list on its own,
     * as a condition compares a list item by item (`PropertyMatch`), and no
     * value left out, as `isNotSet` finds it, not a value.
     */
    static collectPropertyItemsForKey(tasks: Task[], key: string): string[] {
        if (!key) return [];
        const set = new Set<string>();
        for (const task of tasks) {
            const value = PropertyKey.get(getEffectiveProperties(task), key)?.value;
            if (!value || value.type === 'null') continue;
            for (const item of value.type === 'list' ? value.items : [value]) {
                const shown = PropertyValues.display(item);
                if (shown !== '') set.add(shown);
            }
        }
        return Array.from(set).sort();
    }
}
