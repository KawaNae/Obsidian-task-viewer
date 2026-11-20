import type { Properties, ScopeKeys, Task } from '../../types';
import type { Inheritance } from './CreatePlaces';
import { createTempTask } from './createTempTask';
import { NoteTasks } from '../parsing/tree/NoteTasks';
import { TagExtractor } from '../parsing/utils/TagExtractor';
import { formatTaskLine } from '../parsing/TaskLineFormat';
import { PropertyUpdatePlanner } from '../persistence/PropertyUpdatePlanner';
import type { NewRow } from '../persistence/NewRow';

/**
 * A task not written yet, as a `Task`: what the fields of a hub on it show
 * and change before anything is written, and the row (`NewRow`) a write
 * puts in a place from it. Pure: what it reads of the place is handed in
 * (`DraftAt`).
 *
 * Its own values are what the user gives it; what it inherits, and from
 * where, are what the place answers it would (`CreatePlaces.facts`), less
 * what the draft says itself, by the rule the reading applies to a row
 * (`NoteTasks.inheritedBy`). They are made again each time the draft
 * changes, as the reading makes them again of a row each time it is read,
 * so the draft reads as the row will once it is written and read.
 *
 * What a row has only once it is a line:
 * - `id`: {@link DRAFT_ID}, which no row of the index is named
 * - `file`: the note it would be written in, there or not yet
 * - `line`: -1, no line of it
 * - `originalText`, `childIds`, `childLines`, `propertyFindings`: none
 */

/** The values a draft is made with, any of them left out. */
export interface DraftSeed {
    statusChar?: string;
    content?: string;
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    /** Its own tags, as `Task.tags` holds them: the content's are put in with them. */
    tags?: string[];
    color?: string | null;
    linestyle?: string | null;
    mask?: string | null;
    properties?: Properties;
}

/** Where a draft would be written: the note, and what a line put there inherits and from where. */
export interface DraftAt extends Inheritance {
    file: string;
}

/** The name of a draft, which no row of the index takes (each names its parser and note: `RowNames`). */
export const DRAFT_ID = 'draft';

const STYLE_FIELDS = ['color', 'linestyle', 'mask'] as const;

/** A draft at `at` holding `seed`'s values as its own. */
export function draftTask(at: DraftAt, seed: DraftSeed = {}): Task {
    const content = seed.content ?? '';
    const base = createTempTask({
        id: DRAFT_ID,
        file: at.file,
        line: -1,
        content,
        statusChar: seed.statusChar,
        startDate: seed.startDate,
        startTime: seed.startTime,
        endDate: seed.endDate,
        endTime: seed.endTime,
        due: seed.due,
    });
    const task: Task = {
        ...base,
        tags: TagExtractor.merge(seed.tags ?? [], TagExtractor.fromContent(content)),
        properties: seed.properties ?? {},
    };
    for (const field of STYLE_FIELDS) if (seed[field] !== undefined) task[field] = seed[field];
    return withPlace(task, at);
}

/**
 * `updates` put over the draft, as a field hands them on (`HubHost.put`).
 * A new name with no tags handed with it keeps the tags the draft declares
 * and takes the new name's in place of the old one's: the tags a name
 * holds are its own (`TagExtractor.declaredTags`), as the reading takes
 * them from the line.
 */
export function applyToDraft(task: Task, updates: Partial<Task>, at: DraftAt): Task {
    const next: Task = { ...task, ...updates };
    if ('content' in updates && !('tags' in updates)) {
        next.tags = TagExtractor.merge(TagExtractor.declaredTags(task.tags, task.content), TagExtractor.fromContent(next.content));
    }
    return withPlace(next, at);
}

/**
 * The draft at `at`: in its note, inheriting what a line put there does,
 * less what the draft says itself. What a place answering again changes.
 */
export function withPlace(task: Task, at: DraftAt): Task {
    const { cascadeContext: _was, inheritedFrom: _from, ...own } = task;
    const placed: Task = { ...own, file: at.file };
    const cascadeContext = NoteTasks.inheritedBy(own, at.inherits);
    if (cascadeContext) placed.cascadeContext = cascadeContext;
    if (at.inheritedFrom) placed.inheritedFrom = at.inheritedFrom;
    return placed;
}

/**
 * The row a write puts in for the draft: its line, and the property lines
 * of its own values, each as a write to a row would put it
 * (`PropertyUpdatePlanner.plan`). A value it has none of has no line: a
 * style left empty, no tags beyond the name's, a property not there. A
 * style or property it says it has none of hides what it would inherit; one
 * it says alike to what it would inherit is written all the same, as its
 * own. No property line, no `properties`.
 */
export function newRowOf(task: Task, keys: ScopeKeys): NewRow {
    const line = formatTaskLine({
        statusChar: task.statusChar,
        content: task.content,
        startDate: task.startDate,
        startTime: task.startTime,
        endDate: task.endDate,
        endTime: task.endTime,
        due: task.due,
    });
    const own: Partial<Task> = {};
    for (const field of STYLE_FIELDS) {
        const value = task[field];
        if (value === null || (value !== undefined && value.trim() !== '')) own[field] = value;
    }
    if (TagExtractor.declaredTags(task.tags, task.content).length > 0) own.tags = task.tags;
    if (Object.keys(task.properties).length > 0) own.properties = task.properties;

    const before: Task = { ...createTempTask({ id: DRAFT_ID }), content: task.content };
    // A new row has no line to take out.
    const ops = PropertyUpdatePlanner.plan(before, own, keys).filter(op => op.op !== 'delete');
    return ops.length > 0 ? { line, properties: { ops, keys } } : { line };
}
