import type { ReadFlow } from '../types';
import type { OutlineReading } from '../services/parsing/utils/Outline';
import { readFlow } from '../services/parsing/utils/FlowLineScanner';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';

/**
 * The editor's reading of a flow group, pure: which task a flow line belongs
 * to, and what the task's program and child block are. Both are asked of the
 * note's one reading (`Outline.read`), and the program is read by the one
 * function the extraction reads it with (`readFlow`), so the editor
 * underlines the command the index reads and no other.
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

/**
 * The flow group of the task at `root`: its program (`readFlow`; undefined
 * when it has no command) and its child block — the lines of its subtree
 * below its own, which the migration notice weighs.
 */
export function flowGroupOf(outline: OutlineReading, root: number): { flow: ReadFlow | undefined; childLines: string[] } {
    return {
        flow: readFlow(outline, root),
        childLines: outline.lines.slice(root + 1, outline.subtreeEnd(root)),
    };
}
