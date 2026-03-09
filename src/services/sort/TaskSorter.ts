import type { DisplayTask } from '../../types';
import type { SortState, SortRule, SortProperty } from './SortTypes';

/**
 * Sorts tasks according to a user-defined SortState.
 * Falls back to default sort (due → startDate → content) when no rules are set.
 * Uses effective (resolved) values for startDate/endDate sort.
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
            const da = a.due || '';
            const db = b.due || '';
            if (da !== db) return da.localeCompare(db);
            const sa = a.effectiveStartDate ?? a.startDate ?? '';
            const sb = b.effectiveStartDate ?? b.startDate ?? '';
            if (sa !== sb) return sa.localeCompare(sb);
            return (a.content || '').localeCompare(b.content || '');
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
            case 'due': return task.due || '';
            case 'startDate': return task.effectiveStartDate ?? task.startDate ?? '';
            case 'endDate': return task.effectiveEndDate ?? task.endDate ?? '';
            case 'file': return task.file || '';
            case 'status': return task.statusChar || '';
            case 'tag': return task.tags[0] || '';
        }
    }
}
