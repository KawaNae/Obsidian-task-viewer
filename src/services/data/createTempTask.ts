import type { ParserId, Task } from '../../types';

/**
 * Inputs accepted by {@link createTempTask}. Anything not provided is
 * filled with the standard "blank Task" default — empty arrays for the
 * substrate fields, `' '` status, parserId `'tv-inline'`, and so on.
 */
export interface TempTaskFields {
    id: string;
    file?: string;
    line?: number;
    indent?: number;
    content?: string;
    statusChar?: string;
    parserId?: ParserId;
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
}

/**
 * Builds a synthetic raw {@link Task} suitable for one of:
 * - feeding through `TaskParser.format()` for string serialization
 * - `TaskRepository.createFrontmatterTaskFile()` for file creation
 * - `toDisplayTask(t, startHour, NO_TASK_LOOKUP)` for modal placeholders
 *
 * Centralizing the construction keeps the substrate fields
 * (`childIds`, `childLines`, `childLineBodyOffsets`, `commands`, `tags`,
 * `properties`) consistent across temp-task call sites and makes
 * `parserId` defaulting explicit.
 */
export function createTempTask(fields: TempTaskFields): Task {
    return {
        id: fields.id,
        file: fields.file ?? '',
        line: fields.line ?? 0,
        indent: fields.indent ?? 0,
        content: fields.content ?? '',
        statusChar: fields.statusChar ?? ' ',
        parserId: fields.parserId ?? 'tv-inline',
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        commands: [],
        originalText: '',
        tags: [],
        properties: {},
        startDate: fields.startDate,
        startTime: fields.startTime,
        endDate: fields.endDate,
        endTime: fields.endTime,
        due: fields.due,
    };
}
