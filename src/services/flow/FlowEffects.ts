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
    | { kind: 'delete-original' };
