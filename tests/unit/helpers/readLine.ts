import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { DEFAULT_SETTINGS, type Task, type TaskViewerSettings } from '../../../src/types';

/**
 * The row a note of the one line `line` holds, read as the index reads a
 * note: the line's command and dates, its verdict — everything a row carries
 * that a line parser alone does not say (`readFlow` reads the command). Null
 * when the line holds no row.
 */
export function readLine(line: string, settings: TaskViewerSettings = DEFAULT_SETTINGS, file = 'test.md'): Task | null {
    const { tasks } = FileParsePipeline.parse(file, [line], settings);
    return tasks[0] ?? null;
}
