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
            const prevEl = this.container.querySelector(`.task-card[data-id="${this.selectedTaskId}"]`) as HTMLElement;
            if (prevEl) {
                // Restore original z-index from data attribute
                const originalZ = prevEl.dataset.originalZIndex;
                prevEl.style.zIndex = originalZ || '';
            }
        }

        this.selectedTaskId = taskId;

        // Update .selected class on all task cards
        const taskCards = this.container.querySelectorAll('.task-card');
        taskCards.forEach(el => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.dataset.id === taskId) {
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
        const taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
        if (!taskEl) return;

        const handles = taskEl.querySelectorAll('.task-card__handle');
        handles.forEach(h => h.remove());
    }

    /**
     * Renders handles directly inside the task card element.
     */
    private renderHandles(taskId: string): void {
        const taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
        if (!taskEl) return;

        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        // Remove existing handles first
        this.removeHandles(taskId);

        const isFuture = task.isFuture;
        const isAllDay = taskEl.classList.contains('task-card--allday');

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
            this.createResizeHandle(taskEl, taskId, 'top', '↕');
            this.createResizeHandle(taskEl, taskId, 'bottom', '↕');
            this.createMoveHandle(taskEl, taskId);
        }
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
