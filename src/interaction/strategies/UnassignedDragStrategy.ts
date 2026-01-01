import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { createGhostElement, removeGhostElement } from '../GhostFactory';

export class UnassignedDragStrategy implements DragStrategy {
    name = 'Unassigned';

    private dragTask: Task | null = null;
    private ghostEl: HTMLElement | null = null;
    private initialX: number = 0;
    private initialY: number = 0;
    private hasMoved: boolean = false;
    private lastHighlighted: HTMLElement | null = null;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.initialX = e.clientX;
        this.initialY = e.clientY;
        this.hasMoved = false;

        // Create Ghost Element (即表示、createElement方式)
        const doc = context.container.ownerDocument || document;
        this.ghostEl = createGhostElement(el, doc, { initiallyVisible: true });

        el.addClass('is-dragging-source');
    }

    onMove(e: PointerEvent, context: DragContext) {
        if (!this.ghostEl) return;

        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;

        if (!this.hasMoved && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
            this.hasMoved = true;
        }

        if (this.hasMoved) {
            this.ghostEl.style.left = `${e.clientX + 10}px`;
            this.ghostEl.style.top = `${e.clientY + 10}px`;

            // Update drop zone highlighting
            this.updateDropZoneHighlight(e, context);
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.ghostEl) return;

        // Clear any remaining highlights
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        removeGhostElement(this.ghostEl);
        this.ghostEl = null;

        const sourceEl = context.container.querySelector(`.task-card[data-id="${this.dragTask.id}"]`);
        if (sourceEl) {
            sourceEl.removeClass('is-dragging-source');
        }

        if (!this.hasMoved) {
            context.onTaskClick(this.dragTask.id);
            return;
        }

        // Determine Drop Target
        const doc = context.container.ownerDocument || document;
        const elements = doc.elementsFromPoint(e.clientX, e.clientY);

        if (elements.length === 0) return;

        const updates: Partial<Task> = {
            isFuture: false
        };

        // Find targets in the stack
        let allDayCell: HTMLElement | null = null;
        let dayCol: HTMLElement | null = null;

        for (const el of elements) {
            const cell = el.closest('.all-day-cell') as HTMLElement;
            if (cell && !cell.hasClass('all-day-axis')) {
                allDayCell = cell;
                break;
            }
            if (!dayCol) {
                dayCol = el.closest('.day-timeline-column') as HTMLElement;
            }
        }

        // 1. All-Day Row Target
        if (allDayCell && allDayCell.dataset.date) {
            updates.startDate = allDayCell.dataset.date;
            updates.startTime = undefined;
            updates.endTime = undefined;
            updates.endDate = undefined; // S-All tasks are single day (implied)
            await context.taskIndex.updateTask(this.dragTask.id, updates);
            return;
        }

        // 2. Timeline Column Target
        if (dayCol && dayCol.dataset.date) {
            updates.startDate = dayCol.dataset.date;

            const rect = dayCol.getBoundingClientRect();
            const yInContainer = e.clientY - rect.top;

            const zoomLevel = context.plugin.settings.zoomLevel;
            const snapPixels = 15 * zoomLevel;
            const snappedTop = Math.round(yInContainer / snapPixels) * snapPixels;

            const startHour = context.plugin.settings.startHour;
            const startHourMinutes = startHour * 60;
            const minutesFromStart = snappedTop / zoomLevel;
            const totalMinutes = startHourMinutes + minutesFromStart;

            updates.startTime = DateUtils.minutesToTime(totalMinutes);
            updates.endTime = DateUtils.minutesToTime(totalMinutes + 60);

            await context.taskIndex.updateTask(this.dragTask.id, updates);
            return;
        }
    }

    private updateDropZoneHighlight(e: PointerEvent, context: DragContext) {
        const doc = context.container.ownerDocument || document;
        // Use elementsFromPoint to handle overlapping elements (like other task cards)
        const elements = doc.elementsFromPoint(e.clientX, e.clientY);

        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        if (elements.length === 0) return;

        // Find targets in the stack of elements
        let allDayCell: HTMLElement | null = null;
        let timelineCol: HTMLElement | null = null;

        for (const el of elements) {
            const cell = el.closest('.all-day-cell') as HTMLElement;
            if (cell && !cell.hasClass('all-day-axis')) {
                allDayCell = cell;
                break; // Prioritize all-day cell if found
            }
            if (!timelineCol) {
                timelineCol = el.closest('.day-timeline-column') as HTMLElement;
            }
        }

        if (allDayCell) {
            allDayCell.addClass('drag-over');
            this.lastHighlighted = allDayCell;
        } else if (timelineCol) {
            timelineCol.addClass('drag-over');
            this.lastHighlighted = timelineCol;
        }
    }
}
