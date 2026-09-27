import type { Task } from '../../types';
import { splitLines, type ReadMark } from '../persistence/FileLines';
import { plannedOn } from '../persistence/TaskRefs';
import { contentKeyOf, type ContentKey } from './ContentKey';
import type { ReadingId } from './Reading';

/**
 * Whether the index's reading of a file is the file on disk, asked before an
 * operation is planned from it (structure.md, 読みの鮮度).
 *
 * `fresh`: it is, or our own writes carry it there. `stale`: the file changed
 * in a way the index has not read — an edit from outside whose change event
 * has not come, or never will (Obsidian drops some on Windows). `unreadable`:
 * the file could not be read.
 */
export type Verdict = 'fresh' | 'stale' | 'unreadable';

/** A verdict, and the key of the content the disk holds when it was read. */
export interface Checked {
    verdict: Verdict;
    disk: ContentKey | null;
}

/** What a check asks of the index and of the disk. */
export interface CheckDeps {
    /** The file's content now, read in line with our own writes to it (`readInLine`). Throws when it cannot be read. */
    read(path: string): Promise<string>;
    /** Where line `line` of reading `read` stands in content `now` (`TaskScanner.followLine`). */
    follow(path: string, read: ReadingId, line: number, now: ContentKey): number | null;
    /** The index's last reading of the file (`TaskScanner.readingOf`). */
    last(path: string): ReadMark;
}

/**
 * Whether the copy `task` is still the row on the disk: the question the
 * write's first check asks (`WriteSession.row`, the reading's key), asked of
 * the same function with the same arguments, so this never turns away a
 * write that check would let through. A copy carried across our own writes
 * is fresh, and so is one of the file being dragged whose reading since is
 * held back (`TaskScanner.hold`): it is numbered, if not committed.
 *
 * A copy whose name gives no reading is not one the index read: nothing
 * reads it fresh, and the write turns it away on its own (`changed`).
 */
export async function checkCopy(deps: CheckDeps, task: Task): Promise<Checked> {
    const { read, line } = plannedOn(task);
    if (read === undefined) return { verdict: 'fresh', disk: null };
    const disk = await diskKey(deps, task.file);
    if (disk === null) return { verdict: 'unreadable', disk };
    return { verdict: deps.follow(task.file, read, line, disk) === null ? 'stale' : 'fresh', disk };
}

/**
 * Whether the index's last reading of `path` is the file on disk: the check
 * for a row looked up by its anchor (`TaskIndex.freshByAnchor`), which looks
 * in the last reading, whichever it is.
 */
export async function checkFile(deps: CheckDeps, path: string): Promise<Checked> {
    const disk = await diskKey(deps, path);
    if (disk === null) return { verdict: 'unreadable', disk };
    return { verdict: deps.last(path).key === disk ? 'fresh' : 'stale', disk };
}

/** The key of what the disk holds for `path`, or null when it cannot be read. */
async function diskKey(deps: CheckDeps, path: string): Promise<ContentKey | null> {
    try {
        return contentKeyOf(splitLines(await deps.read(path)).lines);
    } catch {
        return null;
    }
}
