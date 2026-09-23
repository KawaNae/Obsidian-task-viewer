import type { Task } from '../../types';
import type { TaskRef } from '../../utils/FileLines';
import { ON_RECORD, type OnRecord, type RowBasis } from './RowBasis';

/**
 * What a write names its target by. The task is the index's copy of the row
 * as the last scan read it; of that copy, only the name and the `^id` say
 * which row is meant. Its line and text say where the row *was*, and a write
 * does not take a coordinate from there (see `TaskScanner.locate`).
 */
export function refOf(task: Task): TaskRef {
    return task.blockId ? { runtimeId: task.id, blockId: task.blockId } : { runtimeId: task.id };
}

/** How a refused write names what it was about, to the user. */
export function subjectOf(task: Task): string {
    return task.content.trim() || task.originalText.trim();
}

/**
 * A row as the index hands it to a write: the file it is in, its name, what to
 * call it if the write has to be refused, and what the operation was planned
 * from. No line travels with it, and nothing to search the file by: the name
 * says which row, and the basis only says whether that row still reads as the
 * plan read it (see `WriteSession.row`).
 */
export interface PlannedTarget {
    file: string;
    ref: TaskRef;
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
        ref: refOf(task),
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
 * stage F9 (see {@link ON_RECORD}).
 */
export interface RecordedTarget {
    file: string;
    ref: TaskRef;
    subject: string;
    basis: OnRecord;
}

export function recordedOn(task: Task): RecordedTarget {
    return { file: task.file, ref: refOf(task), subject: subjectOf(task), basis: ON_RECORD };
}
