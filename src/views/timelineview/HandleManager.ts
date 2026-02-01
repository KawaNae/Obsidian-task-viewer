import { TaskIndex } from '../../services/TaskIndex';
import { Task } from '../../types';

/**
 * Manages drag handles for selected tasks in TimelineView.
 * Handles are rendered directly inside task card elements for native scroll sync.
 */
export class HandleManager {
    private selectedTaskId: string | null = null;

    constructor(
        private container: HTMLElement,
        private taskIndex: TaskIndex
    ) { }

    /**
     * Creates the handle overlay element.
     * @deprecated Kept for backwards compatibility, no longer needed.
     */
    createOverlay(): HTMLElement {
        // No-op: handles are now inside task cards
        return this.container;
    }

    /**
     * Gets the currently selected task ID.
     */
    getSelectedTaskId(): string | null {
        return this.selectedTaskId;
    }

    /**
     * Selects a task and renders its handles.
     */
    selectTask(taskId: string | null): void {
        // Remove handles from previously selected task and restore z-index
        if (this.selectedTaskId) {
            this.removeHandles(this.selectedTaskId);
            // Need to find ALL previous cards (including split ones)
            const prevEls = this.container.querySelectorAll('.task-card');
            prevEls.forEach(el => {
                const htmlEl = el as HTMLElement;
                // Check direct ID or split original ID
                if (htmlEl.dataset.id === this.selectedTaskId || htmlEl.dataset.splitOriginalId === this.selectedTaskId) {
                    if (htmlEl.dataset.originalZIndex) {
                        htmlEl.style.zIndex = htmlEl.dataset.originalZIndex;
                    }
                }
            });
        }

        this.selectedTaskId = taskId;

        // Update .selected class on all task cards
        const taskCards = this.container.querySelectorAll('.task-card');
        taskCards.forEach(el => {
            const htmlEl = el as HTMLElement;
            // Match ID or Split ID
            if (taskId && (htmlEl.dataset.id === taskId || htmlEl.dataset.splitOriginalId === taskId)) {
                el.addClass('selected');
                // Store original z-index and set high z-index for selected
                htmlEl.dataset.originalZIndex = htmlEl.style.zIndex || '1';
                htmlEl.style.zIndex = '200';
            } else {
                el.removeClass('selected');
            }
        });

        // Add handles to newly selected task
        if (taskId) {
            this.renderHandles(taskId);
        }
    }

    /**
     * Updates handle positions (call on scroll/resize).
     * @deprecated No longer needed - handles are inside task cards and scroll with them.
     */
    updatePositions(): void {
        // No-op: handles are inside task cards, CSS handles positioning
    }

    /**
     * Removes handles from a task card.
     */
    private removeHandles(taskId: string): void {
        // Find ALL matching cards
        const taskCards = this.container.querySelectorAll('.task-card');
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
     */
    private renderHandles(taskId: string): void {
        // Find ALL matching cards
        const taskCards = Array.from(this.container.querySelectorAll('.task-card')).filter(el => {
            const htmlEl = el as HTMLElement;
            return htmlEl.dataset.id === taskId || htmlEl.dataset.splitOriginalId === taskId;
        });

        if (taskCards.length === 0) return;

        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        taskCards.forEach(el => {
            const taskEl = el as HTMLElement;

            // Remove existing handles first (safety check)
            const existingHandles = taskEl.querySelectorAll('.task-card__handle');
            existingHandles.forEach(h => h.remove());

            const isFuture = task.isFuture;
            const isAllDay = taskEl.classList.contains('task-card--allday');

            // Split checks
            const isSplitBefore = taskEl.classList.contains('task-card--split-before');
            const isSplitAfter = taskEl.classList.contains('task-card--split-after');

            // --- Render Handles ---
            if (isFuture) {
                // Future tasks only get move handle
                this.createMoveHandle(taskEl, taskId);
            } else if (isAllDay) {
                // Left Resize Handle
                this.createResizeHandle(taskEl, taskId, 'left', '↔');
                // Right Resize Handle
                this.createResizeHandle(taskEl, taskId, 'right', '↔');
                // Move Handle
                this.createMoveHandle(taskEl, taskId);
            } else {
                // Timed tasks: Top/Bottom resize + Move

                // Top Handle: Render unless it's the 'after' segment (start boundary)
                if (!isSplitAfter) {
                    this.createResizeHandle(taskEl, taskId, 'top', '↕');
                }

                // Bottom Handle: Render unless it's the 'before' segment (end boundary)
                if (!isSplitBefore) {
                    this.createResizeHandle(taskEl, taskId, 'bottom', '↕');
                }

                this.createMoveHandle(taskEl, taskId);
            }
        });
    }

    private createResizeHandle(taskEl: HTMLElement, taskId: string, position: 'left' | 'right' | 'top' | 'bottom', icon: string): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--resize-${position}`);
        const handle = container.createDiv('task-card__handle-btn');
        handle.setText(icon);
        handle.dataset.taskId = taskId;
    }

    private createMoveHandle(taskEl: HTMLElement, taskId: string): void {
        const container = taskEl.createDiv('task-card__handle task-card__handle--move');
        const handle = container.createDiv('task-card__handle-btn');
        handle.setText('::');
        handle.dataset.taskId = taskId;
    }
}
