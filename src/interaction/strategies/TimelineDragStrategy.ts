import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { createGhostElement, removeGhostElement } from '../GhostFactory';

export class TimelineDragStrategy implements DragStrategy {
    name = 'Timeline';

    private dragTask: Task | null = null;
    private dragEl: HTMLElement | null = null;
    private ghostEl: HTMLElement | null = null;
    private initialY: number = 0;
    private initialTop: number = 0;
    private initialHeight: number = 0;
    private initialBottom: number = 0;
    private dragOffsetY: number = 0;
    private mode: 'move' | 'resize-top' | 'resize-bottom' = 'move';
    private currentDayDate: string | null = null;
    private hasKeyMoved: boolean = false;
    private lastHighlighted: HTMLElement | null = null;
    private isOutsideSection: boolean = false;

    // Auto-scroll properties
    private autoScrollTimer: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private lastClientX: number = 0;
    private lastClientY: number = 0;
    private currentContext: DragContext | null = null;

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.dragEl = el;
        this.currentContext = context;
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
        this.isOutsideSection = false;

        // Get scroll container reference for auto-scroll
        this.scrollContainer = context.container.querySelector('.timeline-scroll-area') as HTMLElement;

        // Visual feedback
        el.addClass('is-dragging');
        el.style.zIndex = '1000';

        // Create ghost element for cross-section dragging (move mode only)
        if (this.mode === 'move') {
            const doc = context.container.ownerDocument || document;
            this.ghostEl = createGhostElement(el, doc, { useCloneNode: true });
        }
    }

    onMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;
        this.currentContext = context;
        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;

        const deltaY = e.clientY - this.initialY;

        // Threshold check - don't count as moved until 5px movement
        if (!this.hasKeyMoved && Math.abs(deltaY) < 5) return;
        this.hasKeyMoved = true;

        this.processDragMove(e.clientX, e.clientY);

        // Check for auto-scroll when dragging/resizing in timeline
        this.checkAutoScroll(e.clientY);
    }

    private processDragMove(clientX: number, clientY: number) {
        if (!this.dragTask || !this.dragEl || !this.currentContext) return;
        const context = this.currentContext;

        // Snap logic
        const zoomLevel = context.plugin.settings.zoomLevel;
        const snapPixels = 15 * zoomLevel;

        // Find current column
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);
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

            // Note: We do NOT need manual scroll compensation here because getBoundingClientRect()
            // is relative to the viewport. If the container scrolls, rect.top changes, and 
            // yInContainer (clientY - rect.top) automatically reflects the new relative position
            // correctly. Adding scroll compensation would double-count the movement.

            const yInContainer = clientY - rect.top;
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

        // Update cross-section drop zone highlighting only during move
        if (this.mode === 'move') {
            // Check if cursor is outside the timeline section (over Future area)
            const futureSection = elBelow?.closest('.unassigned-section') || elBelow?.closest('.future-section') || elBelow?.closest('.header-bottom-right');
            this.isOutsideSection = !!futureSection;

            // Update ghost and card visibility based on section
            if (this.isOutsideSection && this.ghostEl) {
                // Outside TL section: show ghost, hide original visually
                this.ghostEl.style.opacity = '0.8';
                this.ghostEl.style.left = `${clientX + 10}px`;
                this.ghostEl.style.top = `${clientY + 10}px`;
                this.dragEl.style.opacity = '0.3';
            } else if (this.ghostEl) {
                // Inside TL section: hide ghost
                this.ghostEl.style.opacity = '0';
                this.ghostEl.style.left = '-9999px';
                this.dragEl.style.opacity = '';
            }

            this.updateDropZoneHighlight(clientX, clientY, context);
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl || !this.currentDayDate) return;

        // Clear any remaining highlights
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        // Clean up ghost element
        removeGhostElement(this.ghostEl);
        this.ghostEl = null;

        // Stop auto-scroll
        this.stopAutoScroll();

        this.dragEl.removeClass('is-dragging');
        this.dragEl.style.zIndex = '';
        this.dragEl.style.opacity = '';
        this.currentContext = null;

        if (!this.hasKeyMoved) {
            context.onTaskClick(this.dragTask.id);
            this.dragTask = null;
            this.dragEl = null;
            return;
        }

        // Check for cross-section drops first
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);

        if (elBelow) {
            // Check for drop on Future section (TL→FU) - only if no deadline
            const futureSection = elBelow.closest('.unassigned-section') || elBelow.closest('.future-section') || elBelow.closest('.header-bottom-right');
            if (futureSection && !this.dragTask.deadline) {
                const updates: Partial<Task> = {
                    isFuture: true,
                    startDate: undefined,
                    startTime: undefined,
                    endDate: undefined,
                    endTime: undefined
                };
                await context.taskIndex.updateTask(this.dragTask.id, updates);
                this.dragTask = null;
                this.dragEl = null;
                return;
            }
        }

        // Regular timeline movement/resize within timeline section
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

    private updateDropZoneHighlight(clientX: number, clientY: number, context: DragContext) {
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);

        // Clear previous highlight
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        if (!elBelow) return;

        // Check for valid drop targets (only Future for timeline tasks)
        const futureSection = elBelow.closest('.unassigned-section') || elBelow.closest('.future-section') || elBelow.closest('.header-bottom-right');

        if (futureSection && !this.dragTask?.deadline) {
            // Only allow Future drop if no deadline
            futureSection.addClass('drag-over');
            this.lastHighlighted = futureSection as HTMLElement;
        }
    }

    private checkAutoScroll(mouseY: number): void {
        if (!this.scrollContainer) return;

        const rect = this.scrollContainer.getBoundingClientRect();
        const scrollThreshold = 50; // Pixels from edge to trigger scroll
        const scrollSpeed = 10; // Pixels per scroll step

        let shouldScrollUp = false;
        let shouldScrollDown = false;

        // Check if mouse is near the top or bottom edges of the timeline area
        if (mouseY < rect.top + scrollThreshold) {
            shouldScrollUp = true;
        } else if (mouseY > rect.bottom - scrollThreshold) {
            shouldScrollDown = true;
        }

        if (shouldScrollUp || shouldScrollDown) {
            this.startAutoScroll(shouldScrollUp ? -scrollSpeed : scrollSpeed);
        } else {
            this.stopAutoScroll();
        }
    }

    private startAutoScroll(direction: number): void {
        // Don't start if already running in the same direction
        if (this.autoScrollTimer !== null) return;

        this.autoScrollTimer = window.setInterval(() => {
            if (!this.scrollContainer) return;

            this.scrollContainer.scrollTop += direction;

            // Trigger drag update to keep task synced with scroll
            // Use last known clientX/Y which are relative to viewport
            this.processDragMove(this.lastClientX, this.lastClientY);

            // Stop scrolling if we've reached the boundaries or if direction flipped (not handled here but implicitly safe)
            if (direction < 0 && this.scrollContainer.scrollTop <= 0) {
                this.stopAutoScroll();
            } else if (direction > 0 &&
                this.scrollContainer.scrollTop >=
                this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight) {
                this.stopAutoScroll();
            }
        }, 16); // ~60fps for smooth scrolling
    }

    private stopAutoScroll(): void {
        if (this.autoScrollTimer !== null) {
            clearInterval(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
    }
}
