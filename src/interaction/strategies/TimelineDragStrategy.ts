import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

export class TimelineDragStrategy implements DragStrategy {
    name = 'Timeline';

    private dragTask: Task | null = null;
    private dragEl: HTMLElement | null = null;
    private initialY: number = 0;
    private initialTop: number = 0;
    private initialHeight: number = 0;
    private initialBottom: number = 0;
    private dragOffsetY: number = 0;
    private mode: 'move' | 'resize-top' | 'resize-bottom' = 'move';
    private currentDayDate: string | null = null;
    private hasKeyMoved: boolean = false;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.dragEl = el;
        this.initialY = e.clientY;
        this.initialTop = parseInt(el.style.top || '0');
        this.initialHeight = parseInt(el.style.height || '0');

        const logicalTop = this.initialTop - 1;
        const logicalHeight = this.initialHeight + 3;
        this.initialBottom = logicalTop + logicalHeight;

        const rect = el.getBoundingClientRect();
        this.dragOffsetY = e.clientY - rect.top;

        // Determine Mode
        const target = e.target as HTMLElement;
        if (target.closest('.top-resize-handle')) {
            this.mode = 'resize-top';
        } else if (target.closest('.bottom-resize-handle')) {
            this.mode = 'resize-bottom';
        } else {
            this.mode = 'move';
        }

        const dayCol = el.closest('.day-timeline-column') as HTMLElement;
        this.currentDayDate = dayCol ? dayCol.dataset.date || null : (task.startDate || null);

        this.hasKeyMoved = false;

        // Visual feedback
        el.addClass('is-dragging');
        el.style.zIndex = '1000';
    }

    onMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        const deltaY = e.clientY - this.initialY;

        // Threshold check - don't count as moved until 5px movement
        if (!this.hasKeyMoved && Math.abs(deltaY) < 5) return;
        this.hasKeyMoved = true;

        // Snap logic
        const zoomLevel = context.plugin.settings.zoomLevel;
        const snapPixels = 15 * zoomLevel;

        // Find current column
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
        let dayCol = elBelow?.closest('.day-timeline-column') as HTMLElement;

        // Fallback to parent if slightly out
        if (!dayCol && this.dragEl.parentElement?.classList.contains('day-timeline-column')) {
            dayCol = this.dragEl.parentElement as HTMLElement;
        }

        if (dayCol) {
            if (this.dragEl.parentElement !== dayCol) {
                dayCol.appendChild(this.dragEl);
                this.currentDayDate = dayCol.dataset.date || null;

                // Reset styles
                this.dragEl.style.position = 'absolute';
                this.dragEl.style.width = 'calc(100% - 8px)';
                this.dragEl.style.left = '4px';
            }

            // Calculations
            const rect = dayCol.getBoundingClientRect();
            const yInContainer = e.clientY - rect.top;
            const snappedMouseY = Math.round(yInContainer / snapPixels) * snapPixels;

            if (this.mode === 'move') {
                const rawTop = yInContainer - this.dragOffsetY;
                const snappedTop = Math.round(rawTop / snapPixels) * snapPixels;

                const currentHeight = parseInt(this.dragEl.style.height || `${60 * zoomLevel}`);
                const logicalHeight = currentHeight + 3;

                const maxTop = (1440 * zoomLevel) - logicalHeight;
                const clampedTop = Math.max(0, Math.min(maxTop, snappedTop));

                this.dragEl.style.top = `${clampedTop + 1}px`;
            } else if (this.mode === 'resize-bottom') {
                const logicalTop = this.initialTop - 1;
                const newHeight = Math.max(snapPixels, snappedMouseY - logicalTop);
                const maxHeight = (1440 * zoomLevel) - logicalTop;
                const clampedHeight = Math.min(newHeight, maxHeight);
                this.dragEl.style.height = `${clampedHeight - 3}px`;
            } else if (this.mode === 'resize-top') {
                const currentBottom = this.initialBottom;
                const newTop = Math.max(0, snappedMouseY);
                const clampedTop = Math.max(0, newTop);
                const clampedHeight = Math.max(snapPixels, currentBottom - clampedTop);

                this.dragEl.style.top = `${clampedTop + 1}px`;
                this.dragEl.style.height = `${clampedHeight - 3}px`;
            }
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl || !this.currentDayDate) return;

        this.dragEl.removeClass('is-dragging');
        this.dragEl.style.zIndex = '';

        if (!this.hasKeyMoved) {
            context.onTaskClick(this.dragTask.id);
            this.dragTask = null;
            this.dragEl = null;
            return;
        }

        // Calculate Final Time
        const top = parseInt(this.dragEl.style.top || '0');
        const zoomLevel = context.plugin.settings.zoomLevel;
        const height = parseInt(this.dragEl.style.height || `${60 * zoomLevel}`);

        const logicalTop = top - 1;
        const logicalHeight = height + 3;

        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;

        const startTotalMinutes = (logicalTop / zoomLevel) + startHourMinutes;
        const endTotalMinutes = startTotalMinutes + (logicalHeight / zoomLevel);

        let finalDate = this.currentDayDate;
        let finalStartMinutes = startTotalMinutes;
        let finalEndMinutes = endTotalMinutes;

        // Day Wrap Logic
        if (startTotalMinutes >= 24 * 60) {
            const d = new Date(this.currentDayDate);
            d.setDate(d.getDate() + 1);
            finalDate = d.toISOString().split('T')[0];
            finalStartMinutes -= 24 * 60;
            finalEndMinutes -= 24 * 60;
        }

        const newStartTime = DateUtils.minutesToTime(finalStartMinutes);
        let newEndTime: string;
        let newEndDate: string = finalDate; // Default to same day

        if (finalEndMinutes >= 24 * 60) {
            const endDateObj = new Date(finalDate);
            endDateObj.setDate(endDateObj.getDate() + 1);
            newEndDate = endDateObj.toISOString().split('T')[0];
            // Only store time portion, date is in endDate
            newEndTime = DateUtils.minutesToTime(finalEndMinutes - 24 * 60);
        } else {
            newEndTime = DateUtils.minutesToTime(finalEndMinutes);
        }

        // Always update all fields to handle undefined startDate and full ISO endTime cases
        const updates: Partial<Task> = {
            startDate: finalDate,
            startTime: newStartTime,
            endDate: newEndDate, // Required for TaskParser.format() to output endTime
            endTime: newEndTime
        };

        if (Object.keys(updates).length > 0) {
            await context.taskIndex.updateTask(this.dragTask.id, updates);
        }

        this.dragTask = null;
        this.dragEl = null;
    }
}
