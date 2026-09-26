import type { Task } from '../../types';
import type { RowBasis } from './RowBasis';
import type { ReadingId } from '../core/Reading';
import { TaskIdGenerator } from '../display/TaskIdGenerator';

/** How a refused write names what it was about, to the user. */
export function subjectOf(task: Task): string {
    return task.content.trim() || task.originalText.trim();
}

/**
 * A row as the index hands it to a write: the file it is in, the line the
 * index's copy of it stands on, what to call it if the write has to be
 * refused, and what the operation was planned from. The line is a coordinate
 * in the content the index last read; the basis says whether the file still
 * reads that way there (see `WriteSession.row`). Nothing looks for the row
 * anywhere else.
 *
 * `read` is the reading the copy was made in, which its name carries
 * (`TaskIdGenerator.nameOf`): the line counts only while the file reads as
 * that reading did, or where our own writes from it carried the line
 * (`NamedRow.read`). Undefined for a copy that has no such name, which is
 * not written.
 */
export interface PlannedTarget {
    file: string;
    line: number;
    subject: string;
    basis: RowBasis;
    read: ReadingId | undefined;
}

/** What {@link plannedOn} is told the plan read, besides the row's line. */
export interface PlanReads {
    /** The row's own `==>` lines: a fire's plan reads its command. */
    commands?: boolean;
    /** The row's whole subtree: an operation that takes it away or carries it. */
    subtree?: boolean;
    /** The generation blocks the plan read (see `FlowExecutor.readingBlocks`). */
    blocks?: ReadonlyArray<{ name: string; body: readonly string[] }>;
}

/**
 * The target of an operation planned from the index's copy of `task`: its
 * line, and whatever else `reads` says the plan read of it.
 */
export function plannedOn(task: Task, reads: PlanReads = {}): PlannedTarget {
    return {
        file: task.file,
        line: task.line,
        subject: subjectOf(task),
        read: TaskIdGenerator.readName(task.id)?.reading,
        basis: {
            text: task.originalText,
            ...(reads.commands ? { commands: (task.flow?.childSegments ?? []).map(segment => segment.raw) } : {}),
            // A copy the scan did not read a subtree for is taken to have
            // none: the write is then refused if the row has any, which is
            // the side to err on.
            ...(reads.subtree ? { subtree: task.subtreeLines ?? [task.originalText] } : {}),
            ...(reads.blocks && reads.blocks.length > 0 ? { blocks: reads.blocks } : {}),
        },
    };
}
