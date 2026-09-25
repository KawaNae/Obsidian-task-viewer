import type { Task } from '../../types';
import { onRecord, type OnRecord, type RowBasis } from './RowBasis';

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
 */
export interface PlannedTarget {
    file: string;
    line: number;
    subject: string;
    basis: RowBasis;
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

/**
 * The target of a timer's insert, which stays on the weaker comparison until
 * stage F9 (see {@link OnRecord}).
 */
export interface RecordedTarget {
    file: string;
    line: number;
    subject: string;
    basis: OnRecord;
}

export function recordedOn(task: Task): RecordedTarget {
    return { file: task.file, line: task.line, subject: subjectOf(task), basis: onRecord(task.originalText) };
}
