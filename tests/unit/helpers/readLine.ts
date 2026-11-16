import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import type { UnnamedTask } from '../../../src/services/parsing/TaskFactory';
import { DEFAULT_SETTINGS, type Task, type TaskViewerSettings } from '../../../src/types';

/**
 * The row a note of the one line `line` holds, read as the index reads a
 * note: the line's command and dates, its verdict — everything a row carries
 * that a line parser alone does not say (`readFlow` reads the command). Null
 * when the line holds no row.
 */
export function readLine(line: string, settings: TaskViewerSettings = DEFAULT_SETTINGS, file = 'test.md'): Task | null {
    const { tasks } = FileParsePipeline.parse(file, [line], settings, namesOutsideIndex(file));
    return tasks[0] ?? null;
}

/**
 * The row a line parser read, named as the parse names a row read outside
 * the index (`namesOutsideIndex`): what `FileParsePipeline.parse` makes of
 * it, without the command, the dates and the verdict the pipeline adds.
 */
export function nameOutsideIndex(row: UnnamedTask): Task {
    return { ...namesOutsideIndex(row.file)(row.parserId, row.line), ...row };
}
