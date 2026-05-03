import { setIcon } from 'obsidian';
import { Task } from '../../types';

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

        taskCards.forEach(el => {
            const taskEl = el as HTMLElement;

            const existingHandles = taskEl.querySelectorAll('.task-card__handle');
            existingHandles.forEach(h => h.remove());


            const isCalendar = !!taskEl.closest('.cal-week-row');
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

                // Left edge = start. Move handle moved to bottom edge.
                // detail-handle (top-left) only on the start segment to avoid
                // duplication across split segments.
                if (!continuesBefore) {
                    this.createDetailHandle(taskEl, taskId);
                    this.createMoveHandle(taskEl, taskId, 'bottom-left');
                    this.createResizeHandle(taskEl, taskId, 'left', '↔');
                }

                // Right edge = end. Move handle moved to bottom edge.
                if (!continuesAfter) {
                    this.createMoveHandle(taskEl, taskId, 'bottom-right');
                    this.createResizeHandle(taskEl, taskId, 'right', '↔');
                }
            } else if (isAllDay) {
                // Allday は horizontal split。sawtooth 辺(continues-before の左 /
                // continues-after の右)には handle を出さない。calendar と同じ
                // 設計で、両端 sawtooth (中央 segment) の場合は handles 全部抑制。
                const continuesBefore = isSplitTail;
                const continuesAfter = isSplitHead;
                if (continuesBefore && continuesAfter) {
                    return; // middle segment: no handles
                }

                // Left edge = start. detail-handle は起点 segment にだけ出す
                // (split 跨ぎでの重複を避ける)。
                if (!continuesBefore) {
                    this.createDetailHandle(taskEl, taskId);
                    this.createResizeHandle(taskEl, taskId, 'left', '↔');
                    this.createMoveHandle(taskEl, taskId, 'bottom-left');
                }

                // Right edge = end.
                if (!continuesAfter) {
                    this.createResizeHandle(taskEl, taskId, 'right', '↔');
                    this.createMoveHandle(taskEl, taskId, 'bottom-right');
                }
            } else {
                // Timed tasks: Top/Bottom resize + Top-Right/Bottom-Right Move
                // + detail-handle at top-left (when not touching top boundary).

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
                    if (endH === startHour && endM === 0) {
                        isTouchingBottom = true;
                    }
                }

                // Render Top Handles (Hide if touching top).
                // detail-handle shares the top-edge constraint: -12px would
                // overlap the previous day boundary.
                if (!isTouchingTop) {
                    this.createDetailHandle(taskEl, taskId);
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

    private createMoveHandle(taskEl: HTMLElement, taskId: string, position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'): void {
        const container = taskEl.createDiv(`task-card__handle task-card__handle--move-${position}`);
        const handle = container.createDiv('task-card__handle-btn');
        handle.setText('::');
        handle.dataset.taskId = taskId;
        handle.style.cursor = 'move';
    }

    private createDetailHandle(taskEl: HTMLElement, taskId: string): void {
        const container = taskEl.createDiv('task-card__handle task-card__handle--detail');
        const handle = container.createDiv('task-card__handle-btn');
        // setIcon needs a span wrapper for WebKit to render reliably inside
        // an inline-flex button (matches the more-btn pattern in filter-popover).
        // 'info' (i in a circle) over 'expand' (4 outward arrows): the latter
        // looks like an X and visually bleeds into the card's top-left corner
        // due to the -12px outset, especially on mobile where cards are small.
        setIcon(handle.createSpan(), 'info');
        handle.dataset.taskId = taskId;
        handle.dataset.handleType = 'detail';
        handle.style.cursor = 'pointer';
    }
}
