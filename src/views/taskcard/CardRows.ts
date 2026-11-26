import type { ChildEntry, DisplayTask, Task } from '../../types';
import { buildChildEntries } from '../../services/data/ChildEntryBuilder';
import { toDisplayTask, type TaskLookup } from '../../services/display/DisplayTaskConverter';

/**
 * Where one draw of a card reads rows from: the task's row again, its
 * children and theirs, and each child as displayed, for whether it is done
 * (the counts and the overdue mark). Every read of one draw is of one
 * source, the index or the rows its caller hands it, so a card never shows
 * a child of one with a count of the other.
 */
export interface CardRows {
    /** The row of a name. */
    getTask(id: string): Task | undefined;
    /** The children of a row in the note's order (`buildChildEntries`). */
    getChildEntries(task: Task): ChildEntry[];
    /** The row of a name as displayed. */
    getDisplayTask(id: string): DisplayTask | undefined;
}

/** The reads of a card from `rows`: its children found among them, displayed with `startHour`. */
export function cardRowsOf(rows: TaskLookup, startHour: number): CardRows {
    return {
        getTask: rows,
        getChildEntries: (task) => buildChildEntries(task, rows),
        getDisplayTask: (id) => {
            const row = rows(id);
            return row && toDisplayTask(row, startHour, rows);
        },
    };
}
