import type { Task, TaskViewerSettings } from '../types';
import { getTaskNotation } from '../services/filter/parserTaxonomy';

/** What a checkbox line in the editor offers at its end: the task's menu, the checkbox's, or no button. */
export type LineMenu = 'task' | 'checkbox' | 'none';

/**
 * The button at the end of a checkbox line, and the menu it opens: the one
 * answer for the decorations and for the press (the 2026-10-04 decision on
 * the editor's line menu).
 *
 * - A task of this plugin's notation (tv-inline): the task's menu, while
 *   `editorMenuForTasks`.
 * - A task of the Tasks or Day Planner notation: none. Those are only shown,
 *   and the plugin writes none of them; their own plugin completes and
 *   duplicates them (a write here would make no ✅ date and no recurrence,
 *   and a duplicate would copy the 🆔).
 * - A line the index holds no task on — in a note out of the read range, or
 *   typed and not read yet (`found` null: the index read another content) —
 *   the checkbox's menu, while `editorMenuForCheckboxes`. A line read later
 *   is answered again when the index's change draws the buttons anew.
 *
 * @param found the task the index holds on the line, in the content the
 * editor shows; undefined when none stands there, null when the index has
 * not read that content.
 */
export function lineMenuOf(
    found: Task | null | undefined,
    settings: Pick<TaskViewerSettings, 'editorMenuForTasks' | 'editorMenuForCheckboxes'>,
): LineMenu {
    if (!found) return settings.editorMenuForCheckboxes ? 'checkbox' : 'none';
    if (getTaskNotation(found.parserId) !== 'taskviewer') return 'none';
    return settings.editorMenuForTasks ? 'task' : 'none';
}
