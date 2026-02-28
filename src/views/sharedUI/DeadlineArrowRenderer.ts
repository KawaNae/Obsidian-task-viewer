import type { GridTaskEntry } from '../sharedLogic/GridTaskLayout';

/**
 * Render a deadline arrow element into a grid container.
 * Follows the DOM contract expected by drag strategies:
 * class="deadline-arrow", data-task-id, grid positioning via inline styles.
 */
export function renderDeadlineArrow(
    container: HTMLElement,
    entry: GridTaskEntry,
    gridRowOffset: number,
    gridColOffset: number
): void {
    if (!entry.deadlineArrow) return;

    const { arrowStartCol, arrowEndCol, isClipped, deadlineStr } = entry.deadlineArrow;
    const arrowEl = container.createDiv('deadline-arrow');
    arrowEl.dataset.taskId = entry.task.id;
    arrowEl.style.gridRow = (entry.trackIndex + gridRowOffset).toString();
    arrowEl.style.gridColumnStart = (arrowStartCol + gridColOffset).toString();
    arrowEl.style.gridColumnEnd = (arrowEndCol + gridColOffset).toString();
    arrowEl.setAttribute('aria-label', `Deadline: ${deadlineStr}`);

    if (isClipped) {
        arrowEl.addClass('deadline-arrow--clipped');
    }
}
