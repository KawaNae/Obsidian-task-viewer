import { Outline } from '../parsing/utils/Outline';
import type { LineDraft } from './FileLines';
import type { TaskOp } from './TaskOps';
import { ChildPropertyLineEditor, type PropertyRefusal } from './utils/ChildPropertyLineEditor';

/** The {@link TaskOp} that rewrites a row: its line, and its own property lines. */
export type UpdateOp = Extract<TaskOp, { kind: 'update' }>;

/**
 * Write `op` to the row at `line` of `draft`: the row reads `op.text` at
 * the indentation its line has, and its own property lines change as
 * `op.properties` says (`ChildPropertyLineEditor`). Whatever the lines are
 * — a note's inside a write (`InlineTaskWriter`), or a draft of them no
 * write holds — they come out the same.
 *
 * The row's line is rewritten first: the property lines are all below it,
 * so its line is still `line` afterwards.
 *
 * @returns null when written; else why the property lines could not be,
 * and the row's line has been rewritten in `draft` all the same: a caller
 * that gives the write up throws the draft away.
 */
export function updateRow(draft: LineDraft, line: number, op: UpdateOp, unit: string): PropertyRefusal | null {
    // The row is the one being changed, and stays the same task.
    draft.rewrite(line, Outline.indentOf(draft.lines[line]) + Outline.dedent(op.text));
    if (!op.properties) return null;
    return ChildPropertyLineEditor.applyOps(draft, line, op.properties, unit);
}
