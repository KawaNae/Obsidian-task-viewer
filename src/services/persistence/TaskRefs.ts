import type { Task } from '../../types';
import type { RowRef } from './FileLines';
import type { ReadingId } from '../core/Reading';

/** How a refused write names what it was about, to the user. */
export function subjectOf(task: Task): string {
    return task.content.trim() || task.originalText.trim();
}

/**
 * A copy of a row the index read: one that names the reading it was made in
 * (`Task.reading`), the content its line is a coordinate in. Only such a copy
 * is planned from (`plannedOn`); one read outside the index, or made by no
 * reading, is not written.
 */
export type ReadCopy = Task & { reading: ReadingId };

/** Whether `task` names the reading it was made in (see {@link ReadCopy}). */
export function isReadCopy(task: Task): task is ReadCopy {
    return task.reading !== undefined;
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
 * The row an operation planned from the index's copy of `task` names: its
 * line in the reading the copy was made in, and whatever else `reads` says
 * the plan read of it. The file is the write's to say (`task.file`).
 */
export function plannedOn(task: ReadCopy, reads: PlanReads = {}): RowRef {
    return {
        line: task.line,
        subject: subjectOf(task),
        in: { reading: task.reading },
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
