import type { RowNamer } from '../parsing/tree/NoteTasks';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import type { ReadingId } from './Reading';

/**
 * The names a reading of a note gives its rows: the one place the rows the
 * parse reads (`FileParsePipeline.parse`, which only applies a `RowNamer`)
 * are named.
 */

/**
 * The names reading `reading` of `path` gives its rows (`TaskIdGenerator.nameOf`):
 * which reading, and which line of it. The index's scan names every row it
 * commits so.
 */
export function namesOfReading(path: string, reading: ReadingId): RowNamer {
    return (parserId, line) => TaskIdGenerator.nameOf(parserId, path, line, reading);
}

/**
 * The names of rows read outside the index — a fire planned from the lines a
 * write holds, a send's preview — which no reading of the index names: by
 * line, of a shape `readName` refuses (`TaskIdGenerator.provisionalId`), so
 * none is ever taken for a reading's name. They never reach the store.
 */
export function namesOutsideIndex(path: string): RowNamer {
    return (parserId, line) => TaskIdGenerator.provisionalId(parserId, path, line);
}
