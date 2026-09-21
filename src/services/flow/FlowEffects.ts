import type { Task } from '../../types';
import type { Diagnostic } from '../lang/Diagnostic';
import type { GeneratedChild } from '../persistence/TaskCloner';

/**
 * Effect descriptors produced by the pure planner and applied by the
 * FlowExecutor's interpreter against TaskRepository.
 *
 * ORDER INVARIANT: the planner emits effects in the order
 *   create-next / create-generated → archive-to → strip-flow / delete-original
 * and the interpreter applies them sequentially without reordering.
 * Effects that rewrite or remove the original line must run last, because
 * line resolution (findTaskLineNumber) matches on originalText.
 *
 * What the ordering buys is narrower than it looks: it keeps the original
 * findable only for as long as the line just written reads differently from
 * it, and that holds by value rather than by construction. A written instance
 * always starts unchecked (`buildNextTask` in FlowPlanner, and the status
 * normalization in GeneratedLineCheck) so it cannot read like the line that
 * fired, and an archived copy drops its `==>` and its block id. Where the
 * value stopped differing, the ordering stopped protecting anything: a
 * deletion fire removes a line that never fired and is worded exactly like the
 * instance it writes. Those two effects are not applied in order at all — they
 * are one write, which resolves the line once and takes every number from the
 * array it is writing (see InlineTaskWriter.replaceTaskWithInstances).
 */
export type FlowEffect =
    | { kind: 'create-next'; newTask: Task }
    /**
     * The next instance as a generation block wrote it.
     *
     * Separate from create-next rather than folded into it: the lines are
     * finished here, so the interpreter has one repository call to make and
     * no second way of turning a task into text. A create-next carries a
     * Task the interpreter formats; this carries the text itself, with the
     * flow clause composed and the status already normalized.
     */
    | {
        kind: 'create-generated';
        /** Task line with its flow clause, carrying no indentation. */
        parentLine: string;
        /** Canonical `- ==>` child lines of the new instance. */
        flowLines: string[];
        children: GeneratedChild[];
        /**
         * What the engine corrected on the way, such as a status the block
         * wrote as done. The fire went ahead, so these are not reasons to
         * stop — they are the only record that the written lines differ
         * from the ones the block described, and the interpreter reports
         * them.
         */
        warnings: Diagnostic[];
    }
    | { kind: 'archive-to'; destPath: string; archivedTask: Task }
    | { kind: 'strip-flow' }
    /**
     * `destPath` is where `archive-to` just put the task. The delete carries it
     * so the write layer can see that this removal is one half of a move.
     */
    | { kind: 'delete-original'; destPath: string };
