import type { OutlineReading } from '../services/parsing/utils/Outline';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';

/**
 * The editor's reading of a flow group, pure: which task a flow line belongs
 * to. It is asked of the note's one reading (`Outline.read`), as the task's
 * program is read by the one function the extraction reads it with
 * (`readFlow`), so the editor underlines the command the index reads and no
 * other.
 */

/**
 * The task line a flow line belongs to: the item the outline reads it
 * directly under, when that item opens a task. Null for a flow line under
 * a note bullet, at the top, or in code.
 */
export function flowOwnerOf(outline: OutlineReading, line: number): number | null {
    const parent = outline.item(line)?.parent ?? null;
    if (parent === null || !TaskLineClassifier.opensTask(outline, parent)) return null;
    return parent;
}
