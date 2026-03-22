import { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { TaskIdGenerator } from '../../services/display/TaskIdGenerator';

/**
 * Effective date range for a task, provided by the consumer.
 */
export interface TaskDateRange {
    effectiveStart: string;  // YYYY-MM-DD
    effectiveEnd: string;    // YYYY-MM-DD
}

/**
 * A task placed on the grid with all positional metadata computed.
 */
export interface GridTaskEntry {
    task: DisplayTask;
    /** 1-based column index relative to the dates array */
    colStart: number;
    /** Number of columns occupied */
    span: number;
    /** Row index from track collision detection (0-based) */
    trackIndex: number;
    /** Unique ID for this grid segment (handles split tasks) */
    segmentId: string;
    /** Task extends before the visible date range */
    continuesBefore: boolean;
    /** Task extends after the visible date range */
    continuesAfter: boolean;
    /** Whether this task spans more than one column */
    isMultiDay: boolean;
    /** Due arrow metadata, null if no arrow */
    dueArrow: DueArrowInfo | null;
}

/**
 * Metadata for rendering a due arrow.
 * Column values are 1-based relative to the dates array.
 */
export interface DueArrowInfo {
    /** Column where the arrow starts (task end + 1) */
    arrowStartCol: number;
    /** Column where the arrow ends (due position) */
    arrowEndCol: number;
    /** Whether the due extends beyond the visible range */
    isClipped: boolean;
    /** Raw due string for tooltip */
    dueStr: string;
}

/**
 * Configuration for the layout engine.
 */
export interface GridLayoutConfig {
    /** Date strings (YYYY-MM-DD) representing visible columns */
    dates: string[];
    /** Returns the effective date range for a task, or null to skip */
    getDateRange: (task: DisplayTask) => TaskDateRange | null;
    /** Whether to compute due arrows (default: true) */
    computeDueArrows?: boolean;
}

interface RawEntry {
    task: DisplayTask;
    colStart: number;
    span: number;
    segmentId: string;
    continuesBefore: boolean;
    continuesAfter: boolean;
    isMultiDay: boolean;
    dueArrow: DueArrowInfo | null;
}

/**
 * Compute grid layout for tasks on a date-based grid.
 * Pure function: no DOM, no side effects.
 */
export function computeGridLayout(
    tasks: DisplayTask[],
    config: GridLayoutConfig
): GridTaskEntry[] {
    const { dates } = config;
    if (dates.length === 0) return [];

    const rangeStart = dates[0];
    const rangeEnd = dates[dates.length - 1];
    const computeDueArrows = config.computeDueArrows !== false;

    // Pre-build date→index map for O(1) lookup
    const dateIndex = new Map<string, number>();
    dates.forEach((d, i) => dateIndex.set(d, i));

    // 1. Build raw entries
    const rawEntries: RawEntry[] = [];

    for (const task of tasks) {
        const range = config.getDateRange(task);
        if (!range) continue;

        const { effectiveStart, effectiveEnd } = range;
        if (effectiveStart > rangeEnd || effectiveEnd < rangeStart) continue;

        // Clip to visible range
        const clippedStart = effectiveStart < rangeStart ? rangeStart : effectiveStart;
        const clippedEnd = effectiveEnd > rangeEnd ? rangeEnd : effectiveEnd;

        const startIdx = dateIndex.get(clippedStart);
        const endIdx = dateIndex.get(clippedEnd);
        if (startIdx == null || endIdx == null) continue;

        const colStart = startIdx + 1; // 1-based
        const span = endIdx - startIdx + 1;
        if (span < 1) continue;

        const isMultiDay = effectiveEnd > effectiveStart;
        const continuesBefore = isMultiDay && effectiveStart < rangeStart;
        const continuesAfter = isMultiDay && effectiveEnd > rangeEnd;
        const isSplit = isMultiDay && (continuesBefore || continuesAfter);

        const segmentId = isSplit
            ? TaskIdGenerator.makeSegmentId(task.id, clippedStart)
            : task.id;

        // 2. Compute due arrow
        let dueArrow: DueArrowInfo | null = null;
        if (computeDueArrows && task.due && /^\d{4}-\d{2}-\d{2}/.test(task.due)) {
            const dueDateStr = task.due.split('T')[0];
            const dueDiff = DateUtils.getDiffDays(rangeStart, dueDateStr);
            const maxCol = dates.length;
            let dlCol = dueDiff + 1; // 1-based
            let isClipped = false;

            if (dlCol > maxCol) {
                isClipped = true;
                dlCol = maxCol + 1; // one past the end for arrow rendering
            }

            const taskEndCol = colStart + span; // one past the task end
            if (dlCol > taskEndCol) {
                dueArrow = {
                    arrowStartCol: taskEndCol,
                    arrowEndCol: dlCol,
                    isClipped,
                    dueStr: task.due,
                };
            }
        }

        rawEntries.push({
            task, colStart, span, segmentId,
            continuesBefore, continuesAfter, isMultiDay,
            dueArrow,
        });
    }

    // 3. Sort: colStart ASC, span DESC, file ASC, line ASC, id ASC
    rawEntries.sort((a, b) => {
        if (a.colStart !== b.colStart) return a.colStart - b.colStart;
        if (a.span !== b.span) return b.span - a.span;
        const fileDiff = a.task.file.localeCompare(b.task.file);
        if (fileDiff !== 0) return fileDiff;
        if (a.task.line !== b.task.line) return a.task.line - b.task.line;
        return a.task.id.localeCompare(b.task.id);
    });

    // 4. Assign tracks (greedy first-fit)
    // Each track stores the rightmost occupied column (including due arrow footprint)
    const tracks: number[] = [];
    const result: GridTaskEntry[] = [];

    for (const entry of rawEntries) {
        const footprintEnd = entry.dueArrow
            ? entry.dueArrow.arrowEndCol - 1
            : entry.colStart + entry.span - 1;

        let trackIndex = -1;
        for (let i = 0; i < tracks.length; i++) {
            if (entry.colStart > tracks[i]) {
                trackIndex = i;
                break;
            }
        }

        if (trackIndex === -1) {
            trackIndex = tracks.length;
            tracks.push(footprintEnd);
        } else {
            tracks[trackIndex] = footprintEnd;
        }

        result.push({ ...entry, trackIndex });
    }

    return result;
}
