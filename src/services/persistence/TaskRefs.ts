import type { Task } from '../../types';
import type { TaskRef } from '../../utils/FileLines';

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
 * A row as the index hands it to a write: the file it is in, its name, and
 * what to call it if the write has to be refused. Nothing of the index's copy
 * of the row travels with it — no line, no text to search by, no values to
 * write from.
 */
export interface WriteTarget {
    file: string;
    ref: TaskRef;
    subject: string;
}

export function targetOf(task: Task): WriteTarget {
    return { file: task.file, ref: refOf(task), subject: subjectOf(task) };
}

/**
 * What an operation was planned from: the row as the index read it, and the
 * row's own `- ==>` lines. A fire's plan — the next instance, the text the
 * strip or the archive writes, where a move goes — is made from the index's
 * copy, not from the file, so the write has to find the file still reading
 * as that copy. `locate`'s `edited` does not say so: it accepts any text on
 * record for the row, a write of ours included, and it does not look at the
 * command lines at all.
 */
export interface RowBasis {
    /** The row's line, as the index read it (compared without its indentation). */
    text: string;
    /** The text after `==>` on each of the row's own command lines, in order. */
    commands: readonly string[];
    /**
     * The row and every line of its subtree, verbatim, when the operation
     * wrote them somewhere else first — the source's half of a move away.
     */
    subtree?: readonly string[];
    /**
     * The `tv-gen` blocks of the row's file the plan read, by name, with their
     * body as it read it. A block is the other half of a generated instance's
     * plan: edited since, it would be written as it no longer reads.
     */
    blocks?: ReadonlyArray<{ name: string; body: readonly string[] }>;
}

/** A target that also carries what the operation was planned from. */
export interface PlannedTarget extends WriteTarget {
    basis: RowBasis;
}

export function plannedOn(
    task: Task,
    blocks: ReadonlyArray<{ name: string; body: readonly string[] }> = [],
): PlannedTarget {
    return {
        ...targetOf(task),
        basis: {
            text: task.originalText,
            commands: (task.flow?.childSegments ?? []).map(segment => segment.raw),
            ...(blocks.length > 0 ? { blocks } : {}),
        },
    };
}
