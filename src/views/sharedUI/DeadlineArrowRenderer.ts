import type { GridTaskEntry } from '../sharedLogic/GridTaskLayout';

export interface DeadlineArrowOptions {
    /** Row offset applied to trackIndex (e.g. 2 for calendar date-header row) */
    gridRowOffset?: number;
    /** Column offset (e.g. 1 when week-number column is present) */
    gridColOffset?: number;
}

/**
 * Render a deadline arrow element into a grid container.
 */
export function renderDeadlineArrow(
    container: HTMLElement,
    entry: GridTaskEntry,
    options: DeadlineArrowOptions = {},
): void {
    if (!entry.deadlineArrow) return;

    const { arrowStartCol, arrowEndCol, isClipped, deadlineStr } = entry.deadlineArrow;
    const arrowEl = container.createDiv('deadline-arrow');
    arrowEl.dataset.taskId = entry.task.id;
    arrowEl.setAttribute('aria-label', `Deadline: ${deadlineStr}`);

    const gridRowOffset = options.gridRowOffset ?? 0;
    const gridColOffset = options.gridColOffset ?? 0;
    arrowEl.style.gridRow = (entry.trackIndex + gridRowOffset).toString();
    arrowEl.style.gridColumnStart = (arrowStartCol + gridColOffset).toString();
    arrowEl.style.gridColumnEnd = (arrowEndCol + gridColOffset).toString();

    if (isClipped) {
        arrowEl.addClass('deadline-arrow--clipped');
    }
}
