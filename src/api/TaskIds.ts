import type { Task } from '../types';
import { TaskIdGenerator } from '../services/display/TaskIdGenerator';

/**
 * The public API's and the CLI's task IDs (the names and IDs decision,
 * 2026-09-25). One ID per row, in one of two shapes:
 *
 * - `path#^id` for a row its file anchors (`Task.anchor`: the `^id` no other
 *   line of the file carries). It lasts across edits from outside and
 *   reloads, as long as the line keeps its `^id` alone.
 * - The row's name otherwise: a receipt for one reading of the file. It lasts
 *   until the file changes other than by a write of ours, or the index is
 *   loaded again — a file that comes back to the content it had is read
 *   again, not the reading it was — and is not to be stored.
 *
 * `apiIdOf` gives every ID the API hands out, `id`, `parentId` and
 * `childIds` alike; `readApiId` reads every ID it takes. Nothing else in the
 * API makes or reads one.
 */

/** Finds the index's copy of a row by its name (`TaskIndex.getTask`). */
export type TaskLookup = (name: string) => Task | undefined;

/** An ID the API took, read: which of its two shapes, and what it holds. */
export type ApiTaskId =
    | { kind: 'anchor'; file: string; anchor: string }
    | { kind: 'name'; name: string };

// The last `#^` of the ID: a path may hold `#`, an `^id` holds neither `#`
// nor `^`. A name never ends so — it ends in its reading and line.
const ANCHOR_ID = /^(.+)#\^([A-Za-z0-9-]+)$/;

/**
 * The ID the API hands out for the row `name` names: `path#^id` when the
 * row is anchored, the name itself when it is not, or when no row answers to
 * it. A segment of a row split at the day boundary keeps its suffix after
 * its row's ID.
 */
export function apiIdOf(name: string, lookup: TaskLookup): string {
    const segment = TaskIdGenerator.parseSegmentId(name);
    if (segment) return TaskIdGenerator.makeSegmentId(apiIdOf(segment.baseId, lookup), segment.segmentDate);
    const task = lookup(name);
    return task?.anchor !== undefined ? `${task.file}#^${task.anchor}` : name;
}

/** Which shape an ID the API took has (`apiIdOf`). */
export function readApiId(id: string): ApiTaskId {
    const match = id.match(ANCHOR_ID);
    return match ? { kind: 'anchor', file: match[1], anchor: match[2] } : { kind: 'name', name: id };
}
