import type { DisplayTask } from '../../types';
import type { SortState, SortRule, SortProperty } from './SortTypes';
import { TaskValues } from '../filter/TaskValues';

/** The order used when a list has no sort rules. */
export const DEFAULT_SORT_ORDER: readonly SortProperty[] = ['due', 'startDate', 'content'];

/**
 * Sorts tasks according to a user-defined SortState.
 * Falls back to default sort (due → startDate → content) when no rules are set.
 *
 * A rule compares the value the filter matches ({@link TaskValues}): the
 * effective one, so a due date inherited from a heading or the note sorts as
 * the filter matches it. {@link TaskValues.sortKey} says what text a value
 * compares as.
 */
export class TaskSorter {
    static sort(tasks: DisplayTask[], state: SortState | undefined): void {
        if (!state || state.rules.length === 0) {
            TaskSorter.defaultSort(tasks);
            return;
        }
        tasks.sort((a, b) => {
            for (const rule of state.rules) {
                const cmp = TaskSorter.compare(a, b, rule);
                if (cmp !== 0) return cmp;
            }
            return 0;
        });
    }

    static defaultSort(tasks: DisplayTask[]): void {
        tasks.sort((a, b) => {
            for (const property of DEFAULT_SORT_ORDER) {
                const cmp = TaskSorter.keyOf(a, property).localeCompare(TaskSorter.keyOf(b, property));
                if (cmp !== 0) return cmp;
            }
            return 0;
        });
    }

    private static compare(a: DisplayTask, b: DisplayTask, rule: SortRule): number {
        const cmp = TaskSorter.keyOf(a, rule.property).localeCompare(TaskSorter.keyOf(b, rule.property));
        return rule.direction === 'desc' ? -cmp : cmp;
    }

    private static keyOf(task: DisplayTask, property: SortProperty): string {
        return TaskValues.sortKey(TaskValues.of(task, property));
    }
}
