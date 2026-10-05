import type { RowNamer } from '../parsing/tree/NoteTasks';
import type { ParserId } from '../../types';
import { READING_ID_SOURCE, type ReadingId } from './Reading';

/**
 * The name layer: what a row of one reading is called, and the one place the
 * rows the parse reads (`FileParsePipeline.parse`, which only applies a
 * `RowNamer`) are named.
 *
 * A name is `parserId:path:n:<reading>:<line>`: which reading of the note,
 * and which line of it. It means something only within that reading; what
 * lasts across readings is a row's `^id` (`Task.anchor`), looked up by
 * `TaskIndex.getTaskByAnchor`.
 */

// Only a name (`nameOf`) reads. A row read outside the index
// (`namesOutsideIndex`) is never taken for a reading's.
const NAME_REGEX = new RegExp(String.raw`^([^:]+):(.+):n:(${READING_ID_SOURCE}):(\d+)$`);

/** What a name says (`nameOf`). */
export interface ReadName {
    parserId: string;
    filePath: string;
    reading: ReadingId;
    line: number;
}

/**
 * The name reading `reading` of `filePath` gives the row on `line`: which
 * reading, and which line of it.
 *
 * One reading holds one row per line, so a name picks one row of it, and
 * no two readings share a number (`ReadingId`), so no name is given
 * twice — not even when a write of ours brings the file back to a content
 * it had. A content read again that the last reading read takes no new
 * number, so a `modify` that changed nothing leaves the names as they
 * were. Any other reading of the file gives every row in it a new name: a
 * name is never carried to another reading, where the line it points at
 * could hold another row.
 */
export function nameOf(parserId: ParserId, filePath: string, line: number, reading: ReadingId): string {
    return `${parserId}:${filePath}:n:${reading}:${line}`;
}

/** What a name says (`nameOf`), or null for an ID of any other shape. */
export function readName(id: string): ReadName | null {
    const match = id.match(NAME_REGEX);
    if (!match) return null;
    return { parserId: match[1], filePath: match[2], reading: match[3], line: Number(match[4]) };
}

/**
 * The names reading `reading` of `path` gives its rows (`nameOf`), each row
 * told the reading it is a copy of (`Task.reading`). The index's scan names
 * every row it commits so.
 */
export function namesOfReading(path: string, reading: ReadingId): RowNamer {
    return (parserId, line) => ({ id: nameOf(parserId, path, line, reading), reading });
}

/**
 * The names of rows read outside the index — a fire planned from the lines a
 * write holds, a send's preview — which no reading of the index names: by
 * line, of a shape `readName` refuses, so none is ever taken for a reading's
 * name, and with no reading. They never reach the store.
 *
 * Line-based on purpose: one line yields at most one task, so a name is
 * unique within a file even when two lines share a `^blockId`.
 */
export function namesOutsideIndex(path: string): RowNamer {
    return (parserId, line) => ({ id: `${parserId}:${path}:prov:${line}` });
}
