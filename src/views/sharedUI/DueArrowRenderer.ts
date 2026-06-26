import type { GridTaskEntry } from '../sharedLogic/GridTaskLayout';

export interface DueArrowOptions {
    /** Row offset applied to trackIndex (e.g. 2 for calendar date-header row) */
    gridRowOffset?: number;
    /** Column offset (e.g. 1 when week-number column is present) */
    gridColOffset?: number;
}

/**
 * Render a due arrow element into a grid container. Returns the created element
 * (or null when the entry has no due arrow) so callers can decorate it.
 */
export function renderDueArrow(
    container: HTMLElement,
    entry: GridTaskEntry,
    options: DueArrowOptions = {},
): HTMLElement | null {
    if (!entry.dueArrow) return null;

    const { arrowStartCol, arrowEndCol, isClipped, dueStr } = entry.dueArrow;
    const arrowEl = container.createDiv('due-arrow');
    arrowEl.dataset.taskId = entry.task.id;
    arrowEl.setAttribute('aria-label', `Due: ${dueStr}`);

    const gridRowOffset = options.gridRowOffset ?? 0;
    const gridColOffset = options.gridColOffset ?? 0;
    arrowEl.style.gridRow = (entry.trackIndex + gridRowOffset).toString();
    arrowEl.style.gridColumnStart = (arrowStartCol + gridColOffset).toString();
    arrowEl.style.gridColumnEnd = (arrowEndCol + gridColOffset).toString();

    if (isClipped) {
        arrowEl.addClass('due-arrow--clipped');
    }

    return arrowEl;
}
