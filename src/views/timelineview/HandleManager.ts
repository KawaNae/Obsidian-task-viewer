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
                // Future tasks only get top-right move handle (simplest)
                this.createMoveHandle(taskEl, taskId, 'top-right');
            } else if (isAllDay) {
                // Left Resize Handle
                this.createResizeHandle(taskEl, taskId, 'left', '↔');
                // Right Resize Handle
                this.createResizeHandle(taskEl, taskId, 'right', '↔');
                // Move Handle (Top-Right default for AllDay)
                this.createMoveHandle(taskEl, taskId, 'top-right');
            } else {
                // Timed tasks: Top/Bottom resize + Top-Right/Bottom-Right Move

                // 1. Check if touching Top Boundary (Start Hour)
                // Logic: If task startTime matches startHour:00 exactly, it touches the top.
                // However, visually, 'split-after' ALWAYS touches the top.
                // But user requirement says: "Boundary touching tasks" -> Hide Top Handles.
                // For a split-after task, it effectively starts at StartHour.
                // So split-after should HIDE Top Resize & Top Move.

                // Let's rely on time check for generic case, and class for split case if easier.
                // But time check is more robust for non-split tasks that just happen to start at boundary.

                const startHour = this.taskIndex.getSettings().startHour;
                const [startH, startM] = (task.startTime || '00:00').split(':').map(Number);

                // Touching Top Boundary if:
                // 1. It is a 'split-after' segment (always starts at boundary)
                // 2. OR it starts exactly at StartHour:00 (for normal tasks)
                const isTouchingTop = isSplitAfter || (startH === startHour && startM === 0);

                // Check if touching Bottom Boundary (Next Start Hour)
                // Logic: If task ends exactly at next day's StartHour:00
                // 'split-before' segment always ends at boundary.
                let isTouchingBottom = isSplitBefore;

                if (!isTouchingBottom && task.endTime) {
                    const [endH, endM] = task.endTime.split(':').map(Number);
                    // If end time is StartHour:00, it touches the bottom boundary of the visual day
                    if (endH === startHour && endM === 0) {
                        isTouchingBottom = true;
                    }
                }

                // Render Top Handles (Hide if touching top)
                if (!isTouchingTop) {
                    this.createResizeHandle(taskEl, taskId, 'top', '↕');
                    this.createMoveHandle(taskEl, taskId, 'top-right');
                }

                // Render Bottom Handles (Hide if touching bottom)
                if (!isTouchingBottom) {
                    this.createResizeHandle(taskEl, taskId, 'bottom', '↕');
                    this.createMoveHandle(taskEl, taskId, 'bottom-right');
                }
            }
        });
    }

    private createResizeHandle(taskEl: HTMLElement, taskId: string, position: 'left' | 'right' | 'top' | 'bottom', icon: string): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--resize-${position}`);
        const handle = container.createDiv('task-card__handle-btn');
        handle.setText(icon);
        handle.dataset.taskId = taskId;
    }

    private createMoveHandle(taskEl: HTMLElement, taskId: string, position: 'top-right' | 'bottom-right'): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--move-${position}`);
        const handle = container.createDiv('task-card__handle-btn');
        handle.setText(':');
        handle.dataset.taskId = taskId;
        handle.style.cursor = 'move'; // Ensure cursor is set explicitly if not covered by CSS
    }
}
