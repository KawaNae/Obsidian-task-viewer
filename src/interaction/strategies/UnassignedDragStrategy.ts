import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

export class UnassignedDragStrategy implements DragStrategy {
    name = 'Unassigned';

    private dragTask: Task | null = null;
    private ghostEl: HTMLElement | null = null;
    private initialX: number = 0;
    private initialY: number = 0;
    private hasMoved: boolean = false;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.initialX = e.clientX;
        this.initialY = e.clientY;
        this.hasMoved = false;

        // Create Ghost Element
        this.ghostEl = el.cloneNode(true) as HTMLElement;
        this.ghostEl.addClass('drag-ghost');
        this.ghostEl.style.position = 'fixed';
        this.ghostEl.style.zIndex = '9999';
        this.ghostEl.style.pointerEvents = 'none';
        this.ghostEl.style.opacity = '0.8';
        this.ghostEl.style.width = `${el.offsetWidth}px`;
        this.ghostEl.style.height = `${el.offsetHeight}px`;

        // Initial placement off-screen until move
        this.ghostEl.style.left = '-9999px';

        document.body.appendChild(this.ghostEl);

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
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.ghostEl) return;

        this.ghostEl.remove();
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
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);

        if (!elBelow) return;

        const updates: Partial<Task> = {
            isFuture: false
        };

        // 1. All-Day Row Target
        const allDayCell = elBelow.closest('.all-day-cell') as HTMLElement;
        if (allDayCell && allDayCell.dataset.date) {
            // Drop on All-Day Row
            updates.startDate = allDayCell.dataset.date;
            updates.startTime = undefined;
            updates.endTime = undefined;
            updates.endDate = undefined; // Single day by default
            await context.taskIndex.updateTask(this.dragTask.id, updates);
            return;
        }

        // 2. Timeline Column Target
        const dayCol = elBelow.closest('.day-timeline-column') as HTMLElement;
        if (dayCol && dayCol.dataset.date) {
            // Drop on Timeline
            updates.startDate = dayCol.dataset.date;

            // Calculate Time
            const rect = dayCol.getBoundingClientRect();
            const yInContainer = e.clientY - rect.top;

            const zoomLevel = context.plugin.settings.zoomLevel;
            const snapPixels = 15 * zoomLevel;
            const snappedTop = Math.round(yInContainer / snapPixels) * snapPixels;

            // Logical Time
            // Similar logic to TimelineDragStrategy
            const startHour = context.plugin.settings.startHour;
            const startHourMinutes = startHour * 60;
            const minutesFromStart = snappedTop / zoomLevel;
            const totalMinutes = startHourMinutes + minutesFromStart;

            updates.startTime = DateUtils.minutesToTime(totalMinutes);
            // Default 1h duration?
            updates.endTime = DateUtils.minutesToTime(totalMinutes + 60);

            await context.taskIndex.updateTask(this.dragTask.id, updates);
            return;
        }
    }
}
