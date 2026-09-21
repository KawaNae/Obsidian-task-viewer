import type { Task } from '../../types';
import type { Diagnostic } from '../lang/Diagnostic';
import type { GeneratedChild } from '../persistence/TaskCloner';

/**
 * Effect descriptors produced by the pure planner and applied by the
 * FlowExecutor's interpreter against TaskRepository.
 *
 * ORDER: the planner emits effects in the order
 *   create-next / create-generated → archive-to → strip-flow / delete-original
 * and the interpreter keeps it, as the order of the ops of one write (see
 * FlowExecutor.executeFlow and InlineTaskWriter.applyToTask). Everything a
 * fire does in the row's own file is that one write: the row is located once,
 * and each op after the first takes its line from that answer carried across
 * the splices before it. The next instance goes in at the head of the sibling
 * group, so the row it came from moves down under it and is still the row the
 * later ops are about; nothing searches the file for the row a second time.
 * The one exception is a move to another file, which cannot be one write: the
 * archive is written to the destination first, and only once it has landed is
 * the source's one write made.
 *
 * The order used to protect more than it does. When each effect was a write
 * of its own that found the row by its text, the row stayed findable only for
 * as long as the line just written read differently from it — held by value
 * (a written instance always starts unchecked, an archived copy drops its
 * `==>` and its block id), not by construction. A deletion fire removes a line
 * worded exactly like the instance it writes, and that is where it broke.
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
     * `destPath` is where `archive-to` put the task. Within the row's own
     * file the two are one op, the row carried to the end; to another file
     * this is the removal the source's write makes once the archive landed.
     */
    | { kind: 'delete-original'; destPath: string };
