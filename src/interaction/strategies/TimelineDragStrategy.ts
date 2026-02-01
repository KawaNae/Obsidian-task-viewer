import { DragStrategy, DragContext } from '../DragStrategy';
import { Notice } from 'obsidian';
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

        // Determine Mode first to check for invalid resizes
        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle--resize-top')) {
            this.mode = 'resize-top';
        } else if (target.closest('.task-card__handle--resize-bottom')) {
            this.mode = 'resize-bottom';
        } else {
            this.mode = 'move';
        }

        // 1. Disable Invalid Resizing for Split Tasks
        if (this.mode === 'resize-top' && el.classList.contains('task-card--split-after')) {
            // Preventing resize of the start boundary (it's the day transition)
            console.log('[TimelineDragStrategy] Blocked resize-top on split-after segment');
            this.dragTask = null;
            this.dragEl = null;
            return;
        }
        if (this.mode === 'resize-bottom' && el.classList.contains('task-card--split-before')) {
            // Preventing resize of the end boundary
            console.log('[TimelineDragStrategy] Blocked resize-bottom on split-before segment');
            this.dragTask = null;
            this.dragEl = null;
            return;
        }

        this.initialY = e.clientY;
        this.initialTop = parseInt(el.style.top || '0');
        this.initialHeight = parseInt(el.style.height || '0');

        const rect = el.getBoundingClientRect();
        this.dragOffsetY = e.clientY - rect.top;

        // 2. Expand Split Task on Move
        if (this.mode === 'move' && task.startDate && task.startTime && task.endDate && task.endTime) {
            // Check if we need to expand visually
            const isSplitAfter = el.classList.contains('task-card--split-after');
            // We only need to adjust if we are dragging the 'after' part (to add the 'before' part to visual)
            // Or if we are dragging 'before' part (to add 'after' part)
            // Actually, simpler: Calculate full duration and set height.

            const start = new Date(`${task.startDate}T${task.startTime}`);
            const end = new Date(`${task.endDate}T${task.endTime}`);
            const durationMs = end.getTime() - start.getTime();
            const durationMinutes = durationMs / 60000;

            const zoomLevel = context.plugin.settings.zoomLevel;
            const fullHeight = durationMinutes * zoomLevel;

            // Check if current height is significantly different (implying split)
            if (Math.abs(this.initialHeight - fullHeight) > 5) {
                console.log('[TimelineDragStrategy] Expanding split task for drag');

                // Calculate offset if we are int the 'after' segment
                // The 'before' segment would be "above" us.
                let missingTopHeight = 0;

                if (isSplitAfter) {
                    // We are at the start of the day (StartHour). Task started yesterday.
                    // Calculate how much time passed until StartHour
                    const startHour = context.plugin.settings.startHour;
                    // Need to be careful with crossing calendar days vs crossing visual days
                    // Simplified: The 'after' segment starts at StartHour.
                    // The 'before' segment ends at StartHour.
                    // So we need to add the height of the 'before' segment to the top.
                    // Height of 'before' = (StartHour - TaskStart) -- simplified

                    // Let's compute exact missing minutes
                    // Segment Start (visual) is StartHour.
                    // Task Start is task.startTime.

                    const startHourMinutes = startHour * 60;
                    const taskStartMinutes = DateUtils.timeToMinutes(task.startTime);

                    // Task Start (yesterday) -> Midnight (24:00) -> StartHour
                    let missingMinutes = 0;
                    if (taskStartMinutes > startHourMinutes) {
                        // Started yesterday (e.g. 23:00) vs StartHour (05:00)
                        // Minutes from 23:00 to 24:00 = 60
                        // Minutes from 00:00 to 05:00 = 300
                        // Total = 360
                        missingMinutes = (24 * 60 - taskStartMinutes) + startHourMinutes;
                    } else {
                        // Started earlier today (but previous visual day)? 
                        // e.g. StartHour=5, TaskStart=02:00.
                        // 02:00 to 05:00 = 180 min
                        missingMinutes = startHourMinutes - taskStartMinutes;
                    }

                    missingTopHeight = missingMinutes * zoomLevel;
                }

                // Apply Expansion
                this.dragEl.style.height = `${fullHeight - 3}px`;
                this.initialHeight = fullHeight;

                if (missingTopHeight > 0) {
                    const newTop = this.initialTop - missingTopHeight;
                    this.dragEl.style.top = `${newTop}px`;
                    this.initialTop = newTop;
                    this.dragOffsetY += missingTopHeight; // Fix offset so text doesn't jump
                }
            }
        }

        const logicalTop = this.initialTop - 1;
        const logicalHeight = this.initialHeight + 3;
        this.initialBottom = logicalTop + logicalHeight;

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

        if (dayCol) {
            if (this.dragEl.parentElement !== dayCol) {
                dayCol.appendChild(this.dragEl);
                this.currentDayDate = dayCol.dataset.date || null;

                // Reset styles
                this.dragEl.style.position = 'absolute';
                this.dragEl.style.width = 'calc(100% - 8px)';
                this.dragEl.style.left = '4px';
            }
        }

        // If we didn't find a dayCol (e.g. mouse over header), fallback to the current parent
        if (!dayCol && this.dragEl.parentElement?.classList.contains('day-timeline-column')) {
            dayCol = this.dragEl.parentElement as HTMLElement;
        }

        if (dayCol) {
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
                // Allow negative top (previous day visual space)
                // Also allow going below bottom (next day visual space) - maxTop check was preventing full bottom drag
                // But we should probably keep some sanity limits if needed, but for now allow free drag
                this.dragEl.style.top = `${snappedTop + 1}px`;
            } else if (this.mode === 'resize-bottom') {
                const logicalTop = this.initialTop - 1;
                // Height must be at least snapPixels
                const newHeight = Math.max(snapPixels, snappedMouseY - logicalTop);
                // No max height limit needed strictly, user can drag down
                this.dragEl.style.height = `${newHeight - 3}px`;
            } else if (this.mode === 'resize-top') {
                const currentBottom = this.initialBottom;
                // Top can be negative
                const newTop = snappedMouseY;
                const clampedHeight = Math.max(snapPixels, currentBottom - newTop);
                // Adjust top based on height constraint
                const finalTop = currentBottom - clampedHeight;

                this.dragEl.style.top = `${finalTop + 1}px`;
                this.dragEl.style.height = `${clampedHeight - 3}px`;
            }
        }

        // Update cross-section drop zone highlighting only during move
        if (this.mode === 'move') {
            // Check if cursor is outside the timeline section (over Future area)
            const futureSection = elBelow?.closest('.future-section-grid') || elBelow?.closest('.future-section__content') || elBelow?.closest('.future-section__list');
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
        // Reset cursor immediately
        document.body.style.cursor = '';

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
            const futureSection = elBelow.closest('.future-section-grid') || elBelow.closest('.future-section__content') || elBelow.closest('.future-section__list');
            if (futureSection) {
                if (this.dragTask.deadline) {
                    new Notice('DeadlineがあるタスクはFutureに移動できません');
                    this.dragTask = null;
                    this.dragEl = null;
                    return;
                }

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

        // 1. Resolve to the ORIGINAL task to get the true full duration/times
        // The dragged element (dragTask) might be a split segment with clipped times.
        const originalId = (this.dragTask as any).originalTaskId || this.dragTask.id;
        const originalTask = context.taskIndex.getTask(originalId);

        if (!originalTask) {
            console.error(`[TimelineDragStrategy] Original task not found: ${originalId}`);
            this.dragTask = null;
            this.dragEl = null;
            return;
        }

        // Calculate Final Time from Drag State
        const top = parseInt(this.dragEl.style.top || '0');
        const zoomLevel = context.plugin.settings.zoomLevel;
        const height = parseInt(this.dragEl.style.height || `${60 * zoomLevel}`);

        const logicalTop = top - 1;
        const logicalHeight = height + 3;

        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;

        // Visual start/end times in minutes relative to the current card's specific day
        const visualStartTotalMinutes = (logicalTop / zoomLevel) + startHourMinutes;
        const visualEndTotalMinutes = visualStartTotalMinutes + (logicalHeight / zoomLevel);

        let finalDate = this.currentDayDate;
        let finalStartMinutes = visualStartTotalMinutes;
        let finalEndMinutes = visualEndTotalMinutes;

        // Day Wrap Logic (Forward: if visual time goes past midnight 24:00)
        while (finalStartMinutes >= 24 * 60) {
            const d = new Date(finalDate);
            d.setDate(d.getDate() + 1);
            finalDate = d.toISOString().split('T')[0];
            finalStartMinutes -= 24 * 60;
            finalEndMinutes -= 24 * 60;
        }

        // Day Wrap Logic (Backward: if visual time is negative)
        // e.g. -60 min -> Previous Day 23:00 (1440 - 60)
        while (finalStartMinutes < 0) {
            const d = new Date(finalDate);
            d.setDate(d.getDate() - 1);
            finalDate = d.toISOString().split('T')[0];
            finalStartMinutes += 24 * 60;
            finalEndMinutes += 24 * 60;
        }

        const newStartTime = DateUtils.minutesToTime(finalStartMinutes);
        let newEndTime: string;
        let newEndDate: string = finalDate; // Default to same day

        // Handle end time wrapping
        // Note: finalEndMinutes can be > 24*60 (next day) or even > 48*60 (2 days later)
        // But also, if finalStart was negative, finalEnd might still be negative (if task is entirely yesterday)
        // The while loop above ensures finalStart is [0, 1440).
        // So finalEnd must be > finalStart.
        // We only need to check forward wrap for End now.

        const durationMinutes = finalEndMinutes - finalStartMinutes;

        // Calculate End Date/Time from Start + Duration
        // This is safer than manipulating minutes independently
        const startDateObj = new Date(`${finalDate}T${newStartTime}`);
        const endDateObj = new Date(startDateObj.getTime() + durationMinutes * 60000);

        newEndDate = DateUtils.getLocalDateString(endDateObj);
        newEndTime = `${endDateObj.getHours().toString().padStart(2, '0')}:${endDateObj.getMinutes().toString().padStart(2, '0')}`;

        // --- MERGE LOGIC ---
        // We only want to update the side we are resizing. 
        // For 'move', we update everything.
        // For 'resize-top', we update start, keep original END.
        // For 'resize-bottom', we update end, keep original START.

        const updates: Partial<Task> = {};

        if (this.mode === 'move') {
            updates.startDate = finalDate;
            updates.startTime = newStartTime;
            updates.endDate = newEndDate;
            updates.endTime = newEndTime;
        } else if (this.mode === 'resize-top') {
            // Updating START. Preserve ORIGINAL End.
            updates.startDate = finalDate;
            updates.startTime = newStartTime;
            // Keep original end info
            updates.endDate = originalTask.endDate;
            updates.endTime = originalTask.endTime;
        } else if (this.mode === 'resize-bottom') {
            // Updating END. Preserve ORIGINAL Start.
            updates.startDate = originalTask.startDate;
            updates.startTime = originalTask.startTime;
            // Update end info
            updates.endDate = newEndDate;
            updates.endTime = newEndTime;
        }

        if (Object.keys(updates).length > 0) {
            await context.taskIndex.updateTask(this.dragTask.id, updates);
        }

        this.dragTask = null;
        this.dragEl = null;
    }

    private updateDropZoneHighlight(clientX: number, clientY: number, context: DragContext) {
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);

        // Reset cursor by default
        document.body.style.cursor = '';

        // Clear previous highlight
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        if (!elBelow) return;

        // Check for valid drop targets (only Future for timeline tasks)
        const futureSection = elBelow.closest('.future-section-grid') || elBelow.closest('.future-section__content') || elBelow.closest('.future-section__list');

        if (futureSection) {
            if (this.dragTask?.deadline) {
                // Invalid drop: no highlight, just cursor
                document.body.style.cursor = 'not-allowed';
            } else {
                // Valid drop - Target .future-section__content for highlight if possible
                let targetEl = futureSection;
                const futureGrid = futureSection.closest('.future-section-grid') || futureSection.querySelector('.future-section-grid') || (futureSection.hasClass('future-section-grid') ? futureSection : null);

                if (futureGrid) {
                    const content = futureGrid.querySelector('.future-section__content');
                    if (content) targetEl = content as HTMLElement;
                } else if (futureSection.hasClass('future-section__content')) {
                    targetEl = futureSection;
                } else if (futureSection.closest('.future-section__content')) {
                    targetEl = futureSection.closest('.future-section__content') as HTMLElement;
                }

                targetEl.addClass('drag-over');
                this.lastHighlighted = targetEl as HTMLElement;
            }
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
