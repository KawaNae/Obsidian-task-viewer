import { isTvInline, type Task } from '../../types';
import { TaskLineClassifier } from './utils/TaskLineClassifier';
import { formatDateBlock } from './tv-inline/DateBlockFormat';

/**
 * What a task line holds, and nothing about where it sits: the status, the
 * text, the dates, the line's own `==>` tail, the block id and the list
 * marker. A read {@link Task} is one (its marker comes from `originalText`).
 */
export interface TaskLineFields {
    statusChar: string;
    content: string;
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    /**
     * The command on the task line itself, verbatim. `- ==>` child segments
     * are lines of their own and are never written from here.
     */
    flow?: { raw: string };
    blockId?: string;
    /** List marker with the gap after it (`- `, `1. `); `- ` when absent. */
    marker?: string;
}

/**
 * A task line in the plugin's own notation (`tv-inline`): the one spelling of
 * every line the plugin writes, new or rewritten.
 *
 * The date block is the `dates` built-in's own ({@link formatDateBlock}), so
 * a line and a generation block cannot spell one date two ways. The flow tail
 * is re-emitted verbatim, even for a command that does not parse; canonical
 * re-serialization happens only when a fire writes the next instance
 * (FlowPlanner). The line carries no indentation: where it goes decides that.
 */
export function formatTaskLine(fields: TaskLineFields): string {
    const flowStr = fields.flow?.raw ? `==> ${fields.flow.raw}` : '';
    const blockIdStr = fields.blockId ? `^${fields.blockId}` : '';
    return TaskLineClassifier.formatPrefix(fields.statusChar || ' ', '', fields.marker ?? '- ')
        + TaskLineClassifier.joinContent(fields.content, formatDateBlock(fields), flowStr, blockIdStr);
}

/**
 * A read row written back: its line as the row now says it.
 *
 * A `tv-inline` row is spelled by {@link formatTaskLine}, keeping the list
 * marker it was read with, so a row that gains or loses dates is the same
 * parser's line either way. A row of a read-only notation (Day Planner,
 * Tasks) is never rewritten: its line is the one it was read from.
 */
export function formatRow(task: Task): string {
    if (!isTvInline(task)) return task.originalText;
    return formatTaskLine({ ...task, marker: TaskLineClassifier.extractMarker(task.originalText) });
}
