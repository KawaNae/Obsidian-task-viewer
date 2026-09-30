import type { Task } from '../../types';
import { splitLines, type ReadMark } from '../persistence/FileLines';
import { plannedOn } from '../persistence/TaskRefs';
import { contentKeyOf, type ContentKey } from './ContentKey';
import { readReading, type ReadingId } from './Reading';

/**
 * Whether the index's reading of a file is the file on disk, asked before an
 * operation is planned from it (structure.md, 読みの鮮度).
 *
 * `fresh`: it is, or our own writes carry it there. `stale`: the file changed
 * in a way the index has not read — an edit from outside whose change event
 * has not come, or never will (Obsidian drops some on Windows); `disk` is the
 * key of what the disk holds. `unread`: the index has no reading of the file
 * yet (the vault's first scan has not come to it) — which says nothing of a
 * change notice. `unreadable`: the file could not be read.
 */
export type Checked =
    | { verdict: 'fresh' }
    | { verdict: 'stale'; disk: ContentKey }
    | { verdict: 'unread' }
    | { verdict: 'unreadable' };

/**
 * The file as a check of a copy read it. `read` says whether these lines are
 * the reading the copy was made in: when they are not, our own writes carried
 * the row here since, and the copy says what the row was before them — the
 * index has not committed what they left (`TaskScanner.hold`).
 */
export interface OnDisk {
    lines: readonly string[];
    read: boolean;
}

/**
 * {@link Checked} of a copy, with what the check read when it read the file:
 * a fresh copy whose name gives no reading is not checked against anything,
 * and has none.
 */
export type CopyChecked =
    | { verdict: 'fresh'; disk: OnDisk | null }
    | Exclude<Checked, { verdict: 'fresh' }>;

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
export async function checkCopy(deps: CheckDeps, task: Task): Promise<CopyChecked> {
    const { read, line } = plannedOn(task);
    if (read === undefined) return { verdict: 'fresh', disk: null };
    const disk = await diskContent(deps, task.file);
    if (disk === null) return { verdict: 'unreadable' };
    if (deps.follow(task.file, read, line, disk.key) === null) return { verdict: 'stale', disk: disk.key };
    // Followed, so the last reading numbered is what the disk holds.
    return { verdict: 'fresh', disk: { lines: disk.lines, read: readReading(read)?.n === deps.last(task.file).n } };
}

/**
 * Whether the index's last reading of `path` is the file on disk: the check
 * for a row looked up by its anchor (`TaskIndex.freshByAnchor`), which looks
 * in the last reading, whichever it is. A file the index has not read yet is
 * `unread`, not `stale`: no notice was missed for it.
 */
export async function checkFile(deps: CheckDeps, path: string): Promise<Checked> {
    const disk = await diskContent(deps, path);
    if (disk === null) return { verdict: 'unreadable' };
    const last = deps.last(path).key;
    if (last === undefined) return { verdict: 'unread' };
    return last === disk.key ? { verdict: 'fresh' } : { verdict: 'stale', disk: disk.key };
}

/** What the disk holds for `path`, and its key; null when it cannot be read. */
async function diskContent(deps: CheckDeps, path: string): Promise<{ lines: string[]; key: ContentKey } | null> {
    try {
        const { lines } = splitLines(await deps.read(path));
        return { lines, key: contentKeyOf(lines) };
    } catch {
        return null;
    }
}
