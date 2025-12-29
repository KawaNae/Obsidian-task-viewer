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
    private lastHighlighted: HTMLElement | null = null;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.initialX = e.clientX;
        this.initialY = e.clientY;
        this.hasMoved = false;

        // Create Ghost Element
        const doc = context.container.ownerDocument || document;

        // Use clean div and copy content to avoid inheriting problematic classes
        this.ghostEl = doc.createElement('div');
        this.ghostEl.addClass('drag-ghost');
        this.ghostEl.innerHTML = el.innerHTML;

        // Force critical styles for visibility
        this.ghostEl.style.position = 'fixed';
        this.ghostEl.style.zIndex = '2147483647';
        this.ghostEl.style.pointerEvents = 'none';
        this.ghostEl.style.opacity = '0.9';

        const rect = el.getBoundingClientRect();
        this.ghostEl.style.width = `${rect.width}px`;
        this.ghostEl.style.height = `${rect.height}px`;
        this.ghostEl.style.boxSizing = 'border-box';
        this.ghostEl.style.margin = '0';
        this.ghostEl.style.overflow = 'hidden';
        this.ghostEl.style.display = 'block';

        // Apply visual styles with logging and fallback
        const computedStyle = el.ownerDocument.defaultView?.getComputedStyle(el);
        const bg = computedStyle?.backgroundColor;

        console.log('[UnassignedDrag] Rect:', rect.width, rect.height, 'BG:', bg);

        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== '') {
            this.ghostEl.style.backgroundColor = bg;
            this.ghostEl.style.color = computedStyle?.color || '';
            this.ghostEl.style.border = computedStyle?.border || '';
            this.ghostEl.style.borderRadius = computedStyle?.borderRadius || '4px';
            this.ghostEl.style.padding = computedStyle?.padding || '4px';
        } else {
            // Force a visible style if original is transparent
            this.ghostEl.style.backgroundColor = 'var(--background-secondary, #333)';
            this.ghostEl.style.border = '1px solid var(--interactive-accent, #7c3aed)';
            this.ghostEl.style.color = 'var(--text-normal, #eee)';
            this.ghostEl.style.padding = '8px';
            console.log('[UnassignedDrag] Applying fallback styles');
        }

        // Always add strong shadow for lift effect
        this.ghostEl.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.5)';

        // Initial placement off-screen until move
        this.ghostEl.style.left = '-9999px';
        this.ghostEl.style.top = '-9999px';

        // Append to body (safest for fixed positioning)
        doc.body.appendChild(this.ghostEl);
        console.log('[UnassignedDrag] Ghost created via new div with content copy');

        el.addClass('is-dragging-source');
    }

    onMove(e: PointerEvent, context: DragContext) {
        if (!this.ghostEl) return;

        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;

        if (!this.hasMoved && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
            this.hasMoved = true;
            console.log('[UnassignedDrag] hasMoved set to true');
        }

        if (this.hasMoved) {
            this.ghostEl.style.left = `${e.clientX + 10}px`;
            this.ghostEl.style.top = `${e.clientY + 10}px`;
            console.log('[UnassignedDrag] Ghost position:', this.ghostEl.style.left, this.ghostEl.style.top, 'opacity:', this.ghostEl.style.opacity);

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

    private updateDropZoneHighlight(e: PointerEvent, context: DragContext) {
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);

        // Clear previous highlight
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        if (!elBelow) return;

        // Check for valid drop targets
        const allDayCell = elBelow.closest('.all-day-cell') as HTMLElement;
        const timelineCol = elBelow.closest('.day-timeline-column') as HTMLElement;

        if (allDayCell) {
            allDayCell.addClass('drag-over');
            this.lastHighlighted = allDayCell;
        } else if (timelineCol) {
            timelineCol.addClass('drag-over');
            this.lastHighlighted = timelineCol;
        }
    }
}
