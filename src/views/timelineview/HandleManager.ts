import { Task } from '../../types';

interface HandleManagerDeps {
    getTask(id: string): Task | undefined;
    getStartHour(): number;
}

/**
 * Snapshot of the currently selected task. Identity is captured by
 * (file, originalText) in addition to the task id, because inline task ids
 * use line-number anchors (`ln:<N+1>`) and are re-assigned after deletions or
 * insertions. Without the snapshot, selecting task A and then deleting it
 * would cause task B — which shifted into A's line and took over A's id — to
 * be re-selected on the post-delete re-render.
 */
interface TaskSelectionSnapshot {
    taskId: string;
    file: string;
    originalText: string;
}

/**
 * Manages drag handles for selected tasks in TimelineView.
 * Handles are rendered directly inside task card elements for native scroll sync.
 */
export class HandleManager {
    private selection: TaskSelectionSnapshot | null = null;

    constructor(
        private container: HTMLElement,
        private deps: HandleManagerDeps
    ) { }

    /** Returns task cards scoped to the main content area (excludes pinned lists in sidebar). */
    private getMainTaskCards(): NodeListOf<Element> {
        const main = this.container.querySelector('.view-sidebar-main');
        return (main ?? this.container).querySelectorAll('.task-card');
    }

    private buildSnapshot(task: Task): TaskSelectionSnapshot {
        return {
            taskId: task.id,
            file: task.file,
            originalText: task.originalText,
        };
    }

    /**
     * Gets the currently selected task ID.
     */
    getSelectedTaskId(): string | null {
        return this.selection?.taskId ?? null;
    }

    /**
     * Selects a task (or clears selection when passed null) and renders its handles.
     * Accepts the full Task so the selection snapshot can capture identity fields
     * beyond the id.
     */
    selectTask(task: Task | null): void {
        // Remove handles and restore z-index on the previously selected card(s)
        // while the old DOM is still present.
        if (this.selection) {
            const prevId = this.selection.taskId;
            this.removeHandles(prevId);
            const prevEls = this.getMainTaskCards();
            prevEls.forEach(el => {
                const htmlEl = el as HTMLElement;
                if (htmlEl.dataset.id === prevId || htmlEl.dataset.splitOriginalId === prevId) {
                    if (htmlEl.dataset.originalZIndex) {
                        htmlEl.style.zIndex = htmlEl.dataset.originalZIndex;
                    }
                }
            });
        }

        this.selection = task ? this.buildSnapshot(task) : null;
        this.reapplySelectionClass();
    }

    /**
     * Refreshes the snapshot when the selected task itself is edited.
     * View.onChange calls this for notifications whose taskId matches the
     * selection, so controlled edits (status flip, text change) keep the
     * snapshot in sync and the selection survives re-renders.
     */
    refreshSnapshot(task: Task): void {
        if (this.selection && this.selection.taskId === task.id) {
            this.selection = this.buildSnapshot(task);
        }
    }

    /**
     * Verifies the current snapshot still points at the same task in the store.
     * Returns the resolved Task when identity matches, or null if the task is
     * gone or another task has taken over the id (line-number shift case).
     * On mismatch, the selection is cleared.
     */
    resolveSelection(getTask: (id: string) => Task | undefined): Task | null {
        if (!this.selection) return null;
        const task = getTask(this.selection.taskId);
        if (task && task.file === this.selection.file && task.originalText === this.selection.originalText) {
            return task;
        }
        this.selection = null;
        return null;
    }

    /**
     * Applies `.selected` class and handles to the DOM based on the current
     * snapshot. Idempotent — safe to call after any re-render to reflect
     * selection state on fresh DOM.
     */
    reapplySelectionClass(): void {
        const taskId = this.selection?.taskId ?? null;
        const taskCards = this.getMainTaskCards();
        taskCards.forEach(el => {
            const htmlEl = el as HTMLElement;
            if (taskId && (htmlEl.dataset.id === taskId || htmlEl.dataset.splitOriginalId === taskId)) {
                el.addClass('selected');
                htmlEl.dataset.originalZIndex = htmlEl.style.zIndex || '1';
                htmlEl.style.zIndex = '200';
            } else {
                el.removeClass('selected');
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

        const task = this.deps.getTask(taskId);
        if (!task) return;
        if (task.isReadOnly) return;

        taskCards.forEach(el => {
            const taskEl = el as HTMLElement;

            // Remove existing handles first (safety check)
            const existingHandles = taskEl.querySelectorAll('.task-card__handle');
            existingHandles.forEach(h => h.remove());


            const isCalendar = !!taskEl.closest('.calendar-week-row');
            const isAllDay = taskEl.classList.contains('task-card--allday');

            // Split checks (continuation flags)
            const isSplitHead = taskEl.classList.contains('task-card--split-continues-after');
            const isSplitTail = taskEl.classList.contains('task-card--split-continues-before');

            // --- Render Handles ---
            if (isCalendar) {
                const continuesBefore = taskEl.classList.contains('task-card--split-continues-before');
                const continuesAfter = taskEl.classList.contains('task-card--split-continues-after');
                if (continuesBefore && continuesAfter) {
                    return; // middle segment: no handles
                }

                // Left edge = start
                if (!continuesBefore) {
                    this.createMoveHandle(taskEl, taskId, 'top-left');
                    this.createResizeHandle(taskEl, taskId, 'left', '↔');
                }

                // Right edge = end
                if (!continuesAfter) {
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
                // A continues-before segment always starts at StartHour (boundary).
                // Hide Top Resize & Top Move for boundary-touching tasks.

                const startHour = this.deps.getStartHour();
                const [startH, startM] = (task.startTime || '00:00').split(':').map(Number);

                // Touching Top Boundary if:
                // 1. It continues before (always starts at boundary)
                // 2. OR it starts exactly at StartHour:00 (for normal tasks)
                const isTouchingTop = isSplitTail || (startH === startHour && startM === 0);

                // Check if touching Bottom Boundary (Next Start Hour)
                // A continues-after segment always ends at boundary.
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
