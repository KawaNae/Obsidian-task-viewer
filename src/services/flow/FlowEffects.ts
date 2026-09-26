import type { Task } from '../../types';
import type { Diagnostic } from '../lang/Diagnostic';
import type { GeneratedChild } from '../persistence/TaskCloner';
import type { MoveTarget } from './FlowAst';

/**
 * Effect descriptors produced by the pure planner and applied by the
 * FlowExecutor's interpreter against TaskRepository.
 *
 * ORDER: the planner emits effects in the order
 *   create-next / create-generated → move / strip-flow
 * and the interpreter keeps it, as the order of the ops of one write (see
 * FlowExecutor.planTask and InlineTaskWriter.applyOps). Everything a fire
 * does is the write that completed the row, in the row's own note: the row
 * is located once, and each op after the first takes its line from that
 * answer carried across the splices before it. The next instance goes in at
 * the head of the sibling group, so the row it came from moves down under it
 * and is still the row the later ops are about; nothing searches the file
 * for the row a second time.
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
    | { kind: 'strip-flow' }
    /**
     * The row, as `movedTask` reads, carried with its subtree to `to` in its
     * own note — which consumes the command as `strip-flow` does. Where `to`
     * is, and whether it is one place, is answered against the lines the
     * write holds (`FlowExecutor.planTask`, `Placement.heading`).
     */
    | { kind: 'move'; to: MoveTarget; movedTask: Task };
