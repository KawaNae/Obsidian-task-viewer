import { t } from '../../i18n';
import type { DisplayTask } from '../../types';

/**
 * "Show more"-style paging for a collection of independent task lists.
 * State keyed by listId; card rendering is delegated to the caller.
 */
export class TaskPagingController {
    private visibleCounts = new Map<string, number>();

    constructor(
        private readonly getPageSize: () => number,
        private readonly renderCards: (container: HTMLElement, tasks: DisplayTask[]) => void,
    ) {}

    clear(): void {
        this.visibleCounts.clear();
    }

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

    render(container: HTMLElement, allTasks: DisplayTask[], listId: string): void {
        const pageSize = this.getPageSize();
        const visibleCount = this.visibleCounts.get(listId) ?? pageSize;
        const tasksToShow = allTasks.slice(0, visibleCount);
        this.renderCards(container, tasksToShow);
        if (visibleCount < allTasks.length) {
            this.appendShowMoreButton(container, allTasks, visibleCount, listId);
        }
    }

    private appendShowMoreButton(
        container: HTMLElement,
        allTasks: DisplayTask[],
        shownCount: number,
        listId: string,
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
            this.renderCards(container, nextBatch);
            if (newCount < allTasks.length) {
                this.appendShowMoreButton(container, allTasks, newCount, listId);
            }
        });
    }
}
