import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { TaskIdGenerator } from '../../utils/TaskIdGenerator';

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
    task: Task;
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
    /** Deadline arrow metadata, null if no arrow */
    deadlineArrow: DeadlineArrowInfo | null;
}

/**
 * Metadata for rendering a deadline arrow.
 * Column values are 1-based relative to the dates array.
 */
export interface DeadlineArrowInfo {
    /** Column where the arrow starts (task end + 1) */
    arrowStartCol: number;
    /** Column where the arrow ends (deadline position) */
    arrowEndCol: number;
    /** Whether the deadline extends beyond the visible range */
    isClipped: boolean;
    /** Raw deadline string for tooltip */
    deadlineStr: string;
}

/**
 * Configuration for the layout engine.
 */
export interface GridLayoutConfig {
    /** Date strings (YYYY-MM-DD) representing visible columns */
    dates: string[];
    /** Returns the effective date range for a task, or null to skip */
    getDateRange: (task: Task) => TaskDateRange | null;
    /** Whether to compute deadline arrows (default: true) */
    computeDeadlines?: boolean;
}

interface RawEntry {
    task: Task;
    colStart: number;
    span: number;
    segmentId: string;
    continuesBefore: boolean;
    continuesAfter: boolean;
    isMultiDay: boolean;
    deadlineArrow: DeadlineArrowInfo | null;
}

/**
 * Compute grid layout for tasks on a date-based grid.
 * Pure function: no DOM, no side effects.
 */
export function computeGridLayout(
    tasks: Task[],
    config: GridLayoutConfig
): GridTaskEntry[] {
    const { dates } = config;
    if (dates.length === 0) return [];

    const rangeStart = dates[0];
    const rangeEnd = dates[dates.length - 1];
    const computeDeadlines = config.computeDeadlines !== false;

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

        const startIdx = dates.indexOf(clippedStart);
        const endIdx = dates.indexOf(clippedEnd);
        if (startIdx < 0 || endIdx < 0) continue;

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

        // 2. Compute deadline arrow
        let deadlineArrow: DeadlineArrowInfo | null = null;
        if (computeDeadlines && task.deadline && /^\d{4}-\d{2}-\d{2}/.test(task.deadline)) {
            const deadlineDateStr = task.deadline.split('T')[0];
            const deadlineDiff = DateUtils.getDiffDays(rangeStart, deadlineDateStr);
            const maxCol = dates.length;
            let dlCol = deadlineDiff + 1; // 1-based
            let isClipped = false;

            if (dlCol > maxCol) {
                isClipped = true;
                dlCol = maxCol + 1; // one past the end for arrow rendering
            }

            const taskEndCol = colStart + span; // one past the task end
            if (dlCol > taskEndCol) {
                deadlineArrow = {
                    arrowStartCol: taskEndCol,
                    arrowEndCol: dlCol,
                    isClipped,
                    deadlineStr: task.deadline,
                };
            }
        }

        rawEntries.push({
            task, colStart, span, segmentId,
            continuesBefore, continuesAfter, isMultiDay,
            deadlineArrow,
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
    // Each track stores the rightmost occupied column (including deadline arrow footprint)
    const tracks: number[] = [];
    const result: GridTaskEntry[] = [];

    for (const entry of rawEntries) {
        const footprintEnd = entry.deadlineArrow
            ? entry.deadlineArrow.arrowEndCol - 1
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
