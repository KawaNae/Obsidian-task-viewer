import type { DisplayTask } from '../../types';
import type { SortState, SortRule, SortProperty } from './SortTypes';
import { getEffectiveTags } from '../data/EffectiveProperties';

/** The order used when a list has no sort rules. */
const DEFAULT_ORDER: readonly SortProperty[] = ['due', 'startDate', 'content'];

/**
 * Sorts tasks according to a user-defined SortState.
 * Falls back to default sort (due → startDate → content) when no rules are set.
 *
 * Compares the effective (resolved) values the filter compares: a due date
 * inherited from a heading or the note sorts as the filter matches it.
 * {@link getValue} is the one place a rule's property becomes a value.
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
            for (const property of DEFAULT_ORDER) {
                const cmp = TaskSorter.getValue(a, property).localeCompare(TaskSorter.getValue(b, property));
                if (cmp !== 0) return cmp;
            }
            return 0;
        });
    }

    private static compare(a: DisplayTask, b: DisplayTask, rule: SortRule): number {
        const va = TaskSorter.getValue(a, rule.property);
        const vb = TaskSorter.getValue(b, rule.property);
        const cmp = va.localeCompare(vb);
        return rule.direction === 'desc' ? -cmp : cmp;
    }

    private static getValue(task: DisplayTask, property: SortProperty): string {
        switch (property) {
            case 'content': return task.content || '';
            case 'due': return task.effectiveDue || '';
            case 'startDate': return task.effectiveStartDate ?? task.startDate ?? '';
            case 'endDate': return task.effectiveEndDate ?? task.endDate ?? '';
            case 'file': return task.file || '';
            case 'status': return task.statusChar || '';
            case 'tag': return getEffectiveTags(task)[0] || '';
        }
    }
}
