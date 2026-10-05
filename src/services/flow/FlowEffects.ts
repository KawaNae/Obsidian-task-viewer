import type { Task } from '../../types';
import type { Diagnostic } from '../lang/Diagnostic';
import type { FlowInstance } from '../persistence/FlowInstanceLines';

/**
 * Effect descriptors produced by the pure planner and applied by the
 * FlowExecutor's interpreter against TaskRepository.
 *
 * ORDER: the planner emits effects in the order
 *   create-instance → move / strip-flow
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
    /**
     * The next instance, finished: a recurrence's task formatted once
     * (`formatRow`), or the lines a generation block wrote. One shape for
     * both, so the interpreter has one repository op to make and no way of
     * turning a task into text of its own.
     */
    | {
        kind: 'create-instance';
        instance: FlowInstance;
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
     * The row, as `movedTask` reads, carried with its subtree to the section
     * of the heading `heading` in its own note — which consumes the command
     * as `strip-flow` does. Whether that heading is one place is answered
     * against the lines the write holds (`FlowExecutor.planTask`,
     * `Placement.heading`); a failure there fails the fire whole.
     */
    | { kind: 'move'; heading: string; movedTask: Task };
