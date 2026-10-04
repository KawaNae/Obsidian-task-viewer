import type { DisplayTask, TaskViewerSettings } from '../../types';
import { splitTasks } from '../../services/display/TaskSplitter';
import { getTaskDateRange } from '../../services/display/VisualDateRange';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { TIME_TOP_RIGHT } from '../taskcard/TopRightFieldResolver';
import { computeGridLayout, type GridTaskEntry } from '../sharedLogic/GridTaskLayout';
import { renderDueArrow } from './DueArrowRenderer';
import { markHandleSurface } from './handles/HandleSurface';
import type { CardReconciler } from './CardReconciler';

/** Where a lane sits in its row's grid, and how its cards look. */
export interface DateGridLaneOptions {
    /** The days of the lane's columns, in order. A task is cut where the lane ends. */
    dates: readonly string[];
    /** Grid columns before the first day (a time axis, a week number). */
    colOffset: number;
    /** The grid row of the first track. */
    firstRow: number;
    /** The cards' place in the view (`CardKey.scope`). */
    scope: string;
    /** A class every card of the lane carries: the lane's look. */
    cardClass?: string;
    /** Whether a card of one day shows its time at the top right; a bar never does. */
    timeOnSingleDay: boolean;
}

/** The classes a card's place on the lane gives it, put on anew at each draw. */
const PLACE_CLASSES = [
    'task-card--multi-day',
    'task-card--split-continues-before',
    'task-card--split-continues-after',
];

/**
 * The tasks of some days laid on a grid row as cards spanning their days:
 * Calendar's week row and Timeline's all-day row.
 *
 * Each task is cut at the lane's ends, put on the first track it does not
 * overlap (`computeGridLayout`), and drawn compact, with the arrow to its
 * due when the due is later. A card spanning days, or cut at an end, is a
 * bar (`task-card--multi-day`) marked on the cut side. The card's columns
 * and track are written on it (`data-col-start`, `data-span`,
 * `data-track-index`), where the grid drag reads them.
 *
 * @returns the number of tracks drawn
 */
export function drawDateGridLane(
    row: HTMLElement,
    tasks: DisplayTask[],
    options: DateGridLaneOptions,
    deps: { taskRenderer: TaskCardRenderer; settings: TaskViewerSettings; reconciler: CardReconciler },
): number {
    const { dates, colOffset, firstRow } = options;
    const startHour = deps.settings.startHour;
    // A row is one run of days: a task is cut only at the lane's ends, not
    // at the startHour boundary within it.
    const split = splitTasks(tasks, { type: 'date-range', start: dates[0], end: dates[dates.length - 1], startHour });
    const entries = computeGridLayout(split, {
        dates: [...dates],
        getDateRange: (task) => {
            const range = getTaskDateRange(task, startHour);
            if (!range.effectiveStart) return null;
            return { effectiveStart: range.effectiveStart, effectiveEnd: range.effectiveEnd || range.effectiveStart };
        },
        computeDueArrows: true,
    });

    let tracks = 0;
    for (const entry of entries) {
        drawCard(row, entry, options, deps);
        tracks = Math.max(tracks, entry.trackIndex + 1);
        if (entry.dueArrow) {
            renderDueArrow(row, entry, { gridRowOffset: firstRow, gridColOffset: colOffset });
        }
    }
    return tracks;
}

function drawCard(
    row: HTMLElement,
    entry: GridTaskEntry,
    options: DateGridLaneOptions,
    deps: { taskRenderer: TaskCardRenderer; settings: TaskViewerSettings; reconciler: CardReconciler },
): void {
    // A segment of a task cut into weeks or at the lane's ends is a card of its own.
    const key = { scope: options.scope, name: entry.segmentId };
    const reused = deps.reconciler.acquire(key, entry.task);
    const card = reused ?? row.createDiv('task-card');
    if (reused) row.appendChild(reused);
    if (options.cardClass) card.addClass(options.cardClass);
    markHandleSurface(card, 'grid');

    for (const cls of PLACE_CLASSES) card.removeClass(cls);
    if (entry.useBarVariant) card.addClass('task-card--multi-day');
    if (entry.continuesBefore) card.addClass('task-card--split-continues-before');
    if (entry.continuesAfter) card.addClass('task-card--split-continues-after');

    card.dataset.colStart = String(entry.colStart);
    card.dataset.span = String(entry.span);
    card.dataset.trackIndex = String(entry.trackIndex);
    card.style.gridColumn = `${entry.colStart + options.colOffset} / span ${entry.span}`;
    card.style.gridRow = `${entry.trackIndex + options.firstRow}`;

    deps.taskRenderer.render(card, entry.task, deps.settings, {
        key,
        topRight: options.timeOnSingleDay && !entry.useBarVariant
            ? { mode: 'fields', config: TIME_TOP_RIGHT }
            : { mode: 'none' },
        compact: true,
    });
}
