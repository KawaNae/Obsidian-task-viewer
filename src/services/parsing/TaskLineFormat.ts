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
     * The line's `@` blocks after the first, verbatim (a read task's
     * `extraDateBlocks`): written right after the first block, so a row
     * written back keeps what it was read with.
     */
    extraDateBlocks?: string[];
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
 * a line and a generation block cannot spell one date two ways; the extra
 * blocks follow it ({@link formatDates}). The flow tail
 * is re-emitted verbatim, even for a command that does not parse; canonical
 * re-serialization happens only when a fire writes the next instance
 * (FlowPlanner). The line carries no indentation: where it goes decides that.
 */
export function formatTaskLine(fields: TaskLineFields): string {
    const dateStr = formatDates(fields);
    const flowStr = fields.flow?.raw ? `==> ${fields.flow.raw}` : '';
    const blockIdStr = fields.blockId ? `^${fields.blockId}` : '';
    return TaskLineClassifier.formatPrefix(fields.statusChar || ' ', '', fields.marker ?? '- ')
        + TaskLineClassifier.joinContent(fields.content, dateStr, flowStr, blockIdStr);
}

/**
 * The first block, then the extra ones as they were written (issue #198).
 * They stay after the first, so reading the line again takes the same block
 * for the dates, and the diagnostic for the extra blocks stays. A task with
 * no dates left and extra blocks still writes a first block, the empty
 * `@>`, which reads as no dates: without it, the first extra block would be
 * read as the dates the task was just cleared of.
 */
function formatDates(fields: TaskLineFields): string {
    const block = formatDateBlock(fields);
    const extras = fields.extraDateBlocks ?? [];
    if (extras.length === 0) return block;
    return [block || EMPTY_DATE_BLOCK, ...extras].join(' ');
}

/** A date block that writes no date: an empty start and an empty end. */
const EMPTY_DATE_BLOCK = '@>';

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
