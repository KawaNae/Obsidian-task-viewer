import { t } from '../../i18n';
import type { DisplayTask } from '../../types';
import type { CardReconciler } from './CardReconciler';

/**
 * Draw a batch of a list's cards into `container`. `reconciler` is the draw's
 * own when the batch is part of one, and null for a page "Show more" adds
 * later, whose cards are new.
 */
export type DrawCards = (container: HTMLElement, tasks: DisplayTask[], reconciler: CardReconciler | null) => void;

/**
 * "Show more"-style paging for a collection of independent task lists.
 * State keyed by listId; the caller draws the cards of each page.
 */
export class TaskPagingController {
    private visibleCounts = new Map<string, number>();

    constructor(private readonly getPageSize: () => number) {}

    /**
     * Drop paging state for lists that no longer exist, preserving state for
     * lists that survived the re-render. This avoids "Show more" expansions
     * being silently reset on every render of an unchanged list.
     */
    pruneRemovedLists(currentListIds: Set<string>): void {
        for (const listId of [...this.visibleCounts.keys()]) {
            if (!currentListIds.has(listId)) {
                this.visibleCounts.delete(listId);
            }
        }
    }

    resetOne(listId: string): void {
        this.visibleCounts.delete(listId);
    }

    /** Draw the pages of `listId` shown so far, and the button that shows the next. */
    render(
        container: HTMLElement,
        allTasks: DisplayTask[],
        listId: string,
        reconciler: CardReconciler | null,
        drawCards: DrawCards,
    ): void {
        const pageSize = this.getPageSize();
        const visibleCount = this.visibleCounts.get(listId) ?? pageSize;
        const tasksToShow = allTasks.slice(0, visibleCount);
        drawCards(container, tasksToShow, reconciler);
        if (visibleCount < allTasks.length) {
            this.appendShowMoreButton(container, allTasks, visibleCount, listId, drawCards);
        }
    }

    private appendShowMoreButton(
        container: HTMLElement,
        allTasks: DisplayTask[],
        shownCount: number,
        listId: string,
        drawCards: DrawCards,
    ): void {
        const pageSize = this.getPageSize();
        const remaining = allTasks.length - shownCount;
        const btn = container.createDiv('task-paging__show-more');
        btn.setText(t('pinnedList.showMore', { remaining }));
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            btn.remove();
            const newCount = Math.min(shownCount + pageSize, allTasks.length);
            this.visibleCounts.set(listId, newCount);
            const nextBatch = allTasks.slice(shownCount, newCount);
            drawCards(container, nextBatch, null);
            if (newCount < allTasks.length) {
                this.appendShowMoreButton(container, allTasks, newCount, listId, drawCards);
            }
        });
    }
}
