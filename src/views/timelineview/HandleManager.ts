import { TaskIndex } from '../../services/core/TaskIndex';
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

    /** Returns task cards scoped to the main content area (excludes pinned lists in sidebar). */
    private getMainTaskCards(): NodeListOf<Element> {
        const main = this.container.querySelector('.view-sidebar-main');
        return (main ?? this.container).querySelectorAll('.task-card');
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
            // Need to find ALL previous cards (including split ones) within main content
            const prevEls = this.getMainTaskCards();
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

        // Update .selected class on main content task cards only (not pinned lists)
        const taskCards = this.getMainTaskCards();
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
     * Removes handles from a task card.
     */
    private removeHandles(taskId: string): void {
        // Find ALL matching cards in main content area
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
     */
    private renderHandles(taskId: string): void {
        // Find ALL matching cards in main content area
        const taskCards = Array.from(this.getMainTaskCards()).filter(el => {
            const htmlEl = el as HTMLElement;
            return htmlEl.dataset.id === taskId || htmlEl.dataset.splitOriginalId === taskId;
        });

        if (taskCards.length === 0) return;

        const task = this.taskIndex.getTask(taskId);
        if (!task) return;
        if (task.isReadOnly) return;

        taskCards.forEach(el => {
            const taskEl = el as HTMLElement;

            // Remove existing handles first (safety check)
            const existingHandles = taskEl.querySelectorAll('.task-card__handle');
            existingHandles.forEach(h => h.remove());


            const isCalendar = !!taskEl.closest('.calendar-week-row');
            const isAllDay = taskEl.classList.contains('task-card--allday');

            // Split checks
            const isSplitHead = taskEl.classList.contains('task-card--split-head');
            const isSplitTail = taskEl.classList.contains('task-card--split-tail');

            // --- Render Handles ---
            if (isCalendar) {
                const isMiddle = taskEl.classList.contains('task-card--split-middle');
                if (isMiddle) {
                    return;
                }

                const isHead = taskEl.classList.contains('task-card--split-head');
                const isTail = taskEl.classList.contains('task-card--split-tail');

                // Left edge = start
                if (!isTail) {
                    this.createMoveHandle(taskEl, taskId, 'top-left');
                    this.createResizeHandle(taskEl, taskId, 'left', '↔');
                }

                // Right edge = end
                if (!isHead) {
                    this.createMoveHandle(taskEl, taskId, 'top-right');
                    this.createResizeHandle(taskEl, taskId, 'right', '↔');
                }
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
                // However, visually, 'split-tail' ALWAYS touches the top.
                // But user requirement says: "Boundary touching tasks" -> Hide Top Handles.
                // For a split-tail task, it effectively starts at StartHour.
                // So split-tail should HIDE Top Resize & Top Move.

                // Let's rely on time check for generic case, and class for split case if easier.
                // But time check is more robust for non-split tasks that just happen to start at boundary.

                const startHour = this.taskIndex.getSettings().startHour;
                const [startH, startM] = (task.startTime || '00:00').split(':').map(Number);

                // Touching Top Boundary if:
                // 1. It is a 'split-tail' segment (always starts at boundary)
                // 2. OR it starts exactly at StartHour:00 (for normal tasks)
                const isTouchingTop = isSplitTail || (startH === startHour && startM === 0);

                // Check if touching Bottom Boundary (Next Start Hour)
                // Logic: If task ends exactly at next day's StartHour:00
                // 'split-head' segment always ends at boundary.
                let isTouchingBottom = isSplitHead;

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

    private createMoveHandle(taskEl: HTMLElement, taskId: string, position: 'top-right' | 'bottom-right' | 'top-left'): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--move-${position}`);
        const handle = container.createDiv('task-card__handle-btn');
        handle.setText('::');
        handle.dataset.taskId = taskId;
        handle.style.cursor = 'move'; // Ensure cursor is set explicitly if not covered by CSS
    }
}
