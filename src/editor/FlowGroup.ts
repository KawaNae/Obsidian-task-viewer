import type { OutlineReading } from '../services/parsing/utils/Outline';
import { collectFlowLineIndices } from '../services/parsing/utils/FlowLineScanner';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';

/**
 * The editor's reading of a flow group, pure: which task a flow line belongs
 * to, and which lines are a task's flow lines and its child block. Both are
 * asked of the note's one reading (`Outline.read`), as the parser asks them
 * (`TreeTaskExtractor.mergeChildFlow`), so the editor underlines the command
 * the index reads and no other.
 */

/**
 * The task line a flow line belongs to: the item the outline reads it
 * directly under, when that item is a task line. Null for a flow line under
 * a note bullet, at the top, or in code.
 */
export function flowOwnerOf(outline: OutlineReading, line: number): number | null {
    const parent = outline.item(line)?.parent ?? null;
    if (parent === null || !TaskLineClassifier.opensTask(outline, parent)) return null;
    return parent;
}

/**
 * The flow group of the task at `root`: its own flow lines
 * (`collectFlowLineIndices`) and its child block — the lines of its subtree
 * below its own, which the migration notice weighs.
 */
export function flowGroupOf(outline: OutlineReading, root: number): { flowLines: number[]; childLines: string[] } {
    return {
        flowLines: collectFlowLineIndices(outline, root),
        childLines: outline.lines.slice(root + 1, outline.subtreeEnd(root)),
    };
}
