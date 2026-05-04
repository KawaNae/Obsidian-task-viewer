import { Task } from '../../types';
import { GridHandleStrategy } from './handles/GridHandleStrategy';
import { TimelineHandleStrategy } from './handles/TimelineHandleStrategy';
import type { HandleStrategy } from './handles/HandleStrategy';

const SELECTED_Z_INDEX = 200;

interface HandleManagerDeps {
    getTask(id: string): Task | undefined;
    getStartHour(): number;
}

/**
 * Manages drag handles for selected tasks in TimelineView.
 * Handles are rendered directly inside task card elements for native scroll sync.
 */
export class HandleManager {
    private selectedTaskId: string | null = null;
    private readonly gridStrategy: HandleStrategy = new GridHandleStrategy();
    private readonly timelineStrategy: HandleStrategy = new TimelineHandleStrategy();

    constructor(
        private container: HTMLElement,
        private deps: HandleManagerDeps
    ) { }

    /** Returns task cards scoped to the main content area (excludes pinned lists in sidebar). */
    private getMainTaskCards(): NodeListOf<Element> {
        const main = this.container.querySelector('.tv-sidebar__main');
        return (main ?? this.container).querySelectorAll('.task-card');
    }

    /**
     * Gets the currently selected task ID.
     */
    getSelectedTaskId(): string | null {
        return this.selectedTaskId;
    }

    /**
     * Selects a task (or clears selection when passed null) and renders its handles.
     * The taskId should be a base task id (not a split segment id) so that all
     * segments of the same task get `.is-selected` via `dataset.splitOriginalId`.
     */
    selectTask(taskId: string | null): void {
        // Remove handles from previously selected task and restore z-index.
        if (this.selectedTaskId) {
            this.removeHandles(this.selectedTaskId);
            const prevEls = this.getMainTaskCards();
            prevEls.forEach(el => {
                const htmlEl = el as HTMLElement;
                if (htmlEl.dataset.id === this.selectedTaskId || htmlEl.dataset.splitOriginalId === this.selectedTaskId) {
                    if (htmlEl.dataset.originalZIndex) {
                        htmlEl.style.zIndex = htmlEl.dataset.originalZIndex;
                        delete htmlEl.dataset.originalZIndex;
                    }
                }
            });
        }

        this.selectedTaskId = taskId;
        this.reapplySelectionClass();
    }

    /**
     * Applies `.is-selected` class and handles to the DOM based on the current
     * selectedTaskId. Idempotent — safe to call after any re-render to reflect
     * selection state on fresh DOM.
     */
    reapplySelectionClass(): void {
        const taskId = this.selectedTaskId;
        const taskCards = this.getMainTaskCards();
        taskCards.forEach(el => {
            const htmlEl = el as HTMLElement;
            if (taskId && (htmlEl.dataset.id === taskId || htmlEl.dataset.splitOriginalId === taskId)) {
                if (!htmlEl.dataset.originalZIndex) {
                    htmlEl.dataset.originalZIndex = htmlEl.style.zIndex || '1';
                }
                el.addClass('is-selected');
                htmlEl.style.zIndex = String(SELECTED_Z_INDEX);
            } else {
                el.removeClass('is-selected');
                if (htmlEl.dataset.originalZIndex) {
                    htmlEl.style.zIndex = htmlEl.dataset.originalZIndex;
                    delete htmlEl.dataset.originalZIndex;
                }
            }
        });

        if (taskId) {
            this.renderHandles(taskId);
        }
    }

    /**
     * Removes handles from a task card.
     */
    private removeHandles(taskId: string): void {
        const taskCards = this.getMainTaskCards();
        taskCards.forEach(el => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.dataset.id === taskId || htmlEl.dataset.splitOriginalId === taskId) {
                const handles = htmlEl.querySelectorAll('.task-card__handle');
                handles.forEach(h => h.remove());
            }
        });
    }

    /**
     * Renders handles directly inside the task card element.
     * Surface 別の判定とは「どの edge に何の handle を出すか」だけが違う問題で、
     * それは HandleStrategy が知っている。HandleManager は taskEl の所属を見て
     * strategy を選び、render を委譲するだけ。
     */
    private renderHandles(taskId: string): void {
        const taskCards = Array.from(this.getMainTaskCards()).filter(el => {
            const htmlEl = el as HTMLElement;
            return htmlEl.dataset.id === taskId || htmlEl.dataset.splitOriginalId === taskId;
        });

        if (taskCards.length === 0) return;

        const task = this.deps.getTask(taskId);
        if (!task) return;
        if (task.isReadOnly) return;

        const startHour = this.deps.getStartHour();

        taskCards.forEach(el => {
            const taskEl = el as HTMLElement;

            const existingHandles = taskEl.querySelectorAll('.task-card__handle');
            existingHandles.forEach(h => h.remove());

            const strategy = this.pickStrategy(taskEl);
            strategy.render(taskEl, taskId, task, startHour);
        });
    }

    /**
     * cal-week-row 配下、または .task-card--allday は両方とも grid 系（同じ
     * handle セット: detail + resize-{L,R} + move-bottom-{L,R}）。それ以外は
     * timed task として timeline 戦略。
     */
    private pickStrategy(taskEl: HTMLElement): HandleStrategy {
        if (taskEl.closest('.cal-week-row')) return this.gridStrategy;
        if (taskEl.classList.contains('task-card--allday')) return this.gridStrategy;
        return this.timelineStrategy;
    }
}
