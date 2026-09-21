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
