import { isTvInline, type Task } from '../../types';
import { TaskLineClassifier } from './utils/TaskLineClassifier';
import { formatDateBlock } from './tv-inline/DateBlockFormat';
import { readDateBlock } from './tv-inline/DateBlock';

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
     * The line's `@` blocks the dates were not read from, verbatim (a read
     * task's `unreadDateBlocks`): written right after the dates' block, so a
     * row written back keeps what it was read with.
     */
    unreadDateBlocks?: string[];
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
 * The dates' block, then the blocks the dates were not read from, as they
 * were written (issue #198). They stay after the dates' block, so reading
 * the line again takes the same block for the dates, and the diagnostic for
 * them stays. A task with no dates writes no block of its own, unless the
 * first kept block would then be read as dates: before one that reads, it
 * writes the empty `@>`, which reads as no dates. Without it, the first
 * extra block would be read as the dates the task was just cleared of. A
 * kept block that does not read (`@2026-02-30`) needs none, so writing a
 * row back that had no dates adds nothing to its line.
 */
function formatDates(fields: TaskLineFields): string {
    const block = formatDateBlock(fields);
    const kept = fields.unreadDateBlocks ?? [];
    if (kept.length === 0) return block;
    const first = block || (readsAsDates(kept[0]) ? EMPTY_DATE_BLOCK : '');
    return [first, ...kept].filter(part => part !== '').join(' ');
}

/** Whether `block`, read first on a line, would give the line dates. */
function readsAsDates(block: string): boolean {
    const reading = readDateBlock(block);
    if (!reading || reading.unread) return false;
    const { startDate, startTime, endDate, endTime, due } = reading.values;
    return !!(startDate || startTime || endDate || endTime || due);
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
