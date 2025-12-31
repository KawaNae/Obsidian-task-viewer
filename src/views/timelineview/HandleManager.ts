import { TaskIndex } from '../../services/TaskIndex';
import { Task } from '../../types';

/**
 * Manages drag handles for selected tasks in TimelineView.
 * Handles rendering and positioning of resize/move handles.
 */
export class HandleManager {
    private overlay: HTMLElement | null = null;
    private selectedTaskId: string | null = null;

    constructor(
        private container: HTMLElement,
        private taskIndex: TaskIndex
    ) { }

    /**
     * Creates the handle overlay element.
     */
    createOverlay(): HTMLElement {
        this.overlay = this.container.createDiv('handle-overlay');
        return this.overlay;
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
        this.selectedTaskId = taskId;

        // Update .selected class on all task cards
        const taskCards = this.container.querySelectorAll('.task-card');
        taskCards.forEach(el => {
            if ((el as HTMLElement).dataset.id === taskId) {
                el.addClass('selected');
            } else {
                el.removeClass('selected');
            }
        });

        // Update Handles
        if (taskId) {
            this.renderHandles(taskId);
        } else {
            if (this.overlay) {
                this.overlay.empty();
            }
        }
    }

    /**
     * Updates handle positions (call on scroll/resize).
     */
    updatePositions(): void {
        if (this.selectedTaskId && this.overlay) {
            this.updateHandleGeometry(this.selectedTaskId);
        }
    }

    /**
     * Renders handles for a specific task.
     */
    private renderHandles(taskId: string): void {
        if (!this.overlay) return;

        const taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
        if (!taskEl) return;

        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        const isFuture = task.isFuture;
        const isAllDay = taskEl.classList.contains('all-day');

        // If handles for this task already exist, check if type matches
        const existingWrapper = this.overlay.querySelector(`.handle-wrapper[data-task-id="${taskId}"]`) as HTMLElement;
        if (existingWrapper) {
            const wrapperIsAllDay = existingWrapper.dataset.isAllDay === 'true';
            if (wrapperIsAllDay === isAllDay) {
                this.updateHandleGeometry(taskId);
                return;
            }
            // Type changed, remove and re-create
            existingWrapper.remove();
        }

        this.overlay.empty(); // Clear other handles (only 1 selected at a time)

        // Create wrapper
        const wrapper = this.overlay.createDiv('handle-wrapper');
        wrapper.dataset.taskId = taskId;
        wrapper.dataset.isAllDay = isAllDay.toString();

        // --- Handles ---
        if (isFuture) {
            // Future tasks only get move handle
            this.createMoveHandle(wrapper, taskId);
        } else if (isAllDay) {
            // Left Resize Handle
            this.createResizeHandle(wrapper, taskId, 'left', '↔');
            // Right Resize Handle
            this.createResizeHandle(wrapper, taskId, 'right', '↔');
            // Move Handle
            this.createMoveHandle(wrapper, taskId);
        } else {
            // Top Resize Handle
            this.createResizeHandle(wrapper, taskId, 'top', '↕');
            // Bottom Resize Handle
            this.createResizeHandle(wrapper, taskId, 'bottom', '↕');
            // Move Handle
            this.createMoveHandle(wrapper, taskId);
        }

        // Initial positioning
        this.updateHandleGeometry(taskId);
    }

    private createResizeHandle(wrapper: HTMLElement, taskId: string, position: 'left' | 'right' | 'top' | 'bottom', icon: string): void {
        const container = wrapper.createDiv(`handle-container ${position}-resize-container`);
        container.style.pointerEvents = 'auto';
        const handle = container.createDiv(`handle-btn resize-handle ${position}-resize-handle`);
        handle.setText(icon);
        handle.dataset.taskId = taskId;
    }

    private createMoveHandle(wrapper: HTMLElement, taskId: string): void {
        const container = wrapper.createDiv('handle-container move-handle-container');
        container.style.pointerEvents = 'auto';
        const handle = container.createDiv('handle-btn move-handle');
        handle.setText('::');
        handle.dataset.taskId = taskId;
    }

    /**
     * Updates handle wrapper position to match task element.
     */
    private updateHandleGeometry(taskId: string): void {
        if (!this.overlay) return;

        const wrapper = this.overlay.querySelector(`.handle-wrapper[data-task-id="${taskId}"]`) as HTMLElement;
        const taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;

        if (!wrapper || !taskEl) {
            return;
        }

        const containerRect = this.container.getBoundingClientRect();
        const taskRect = taskEl.getBoundingClientRect();

        // Calculate position relative to container
        const top = taskRect.top - containerRect.top;
        const left = taskRect.left - containerRect.left;
        const width = taskRect.width;
        const height = taskRect.height;

        wrapper.style.top = `${top}px`;
        wrapper.style.left = `${left}px`;
        wrapper.style.width = `${width}px`;
        wrapper.style.height = `${height}px`;
    }
}
