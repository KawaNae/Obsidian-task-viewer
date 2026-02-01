import { DragStrategy, DragContext } from '../DragStrategy';
import { Notice } from 'obsidian';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { GhostManager, GhostSegment } from '../GhostManager';

export class TimelineDragStrategy implements DragStrategy {
    name = 'Timeline';

    private dragTask: Task | null = null;
    private dragEl: HTMLElement | null = null;
    private ghostManager: GhostManager | null = null;

    // Original task geometry
    private initialY: number = 0;
    private initialTop: number = 0;
    private initialHeight: number = 0;
    private initialBottom: number = 0;
    private dragOffsetY: number = 0; // offset of mouse within the card
    private dragOffsetBottom: number = 0; // offset from bottom (for end-anchor)
    private anchorType: 'start' | 'end' = 'start';
    private lastDragResult: { startDate: string, startTime: string, endDate: string, endTime: string } | null = null;

    // Drag mode
    private mode: 'move' | 'resize-top' | 'resize-bottom' = 'move';
    private currentDayDate: string | null = null;
    private hasKeyMoved: boolean = false;
    private lastHighlighted: HTMLElement | null = null;

    private isOutsideSection: boolean = false;
    private hiddenElements: HTMLElement[] = [];

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
        this.ghostManager = new GhostManager(context.container);

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
            console.log('[TimelineDragStrategy] Blocked resize-top on split-after segment');
            this.dragTask = null;
            this.dragEl = null;
            return;
        }
        if (this.mode === 'resize-bottom' && el.classList.contains('task-card--split-before')) {
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
        this.dragOffsetBottom = rect.bottom - e.clientY;

        // Determine Anchor Type
        // If split-after, we anchor to the END (Bottom Right handle) to prevent snapping to start boundary
        if (el.classList.contains('task-card--split-after')) {
            this.anchorType = 'end';
            console.log('[TimelineDragStrategy] Anchor: END (split-after)');
        } else {
            this.anchorType = 'start';
            console.log('[TimelineDragStrategy] Anchor: START');
        }

        // 2. Expand Split Task on Move (Virtual Expansion using Original Task Logic)
        if (this.mode === 'move') {
            const originalId = (task as any).originalTaskId || task.id;
            const originalTask = context.taskIndex.getTask(originalId);

            if (originalTask && originalTask.startDate && originalTask.startTime && originalTask.endDate && originalTask.endTime) {
                const start = new Date(`${originalTask.startDate}T${originalTask.startTime}`);
                const end = new Date(`${originalTask.endDate}T${originalTask.endTime}`);

                // Handle day wrapping for duration calc
                if (end < start) {
                    end.setDate(end.getDate() + 1);
                }

                const durationMs = end.getTime() - start.getTime();
                const durationMinutes = durationMs / 60000;
                const zoomLevel = context.plugin.settings.zoomLevel;
                const fullHeight = durationMinutes * zoomLevel;

                // If we are dragging a split segment, we want to visually simulate dragging the WHOLE task.
                // Ideally, we calculate the offset based on where the segment is relative to the start.
                // However, for Simplicity in V1 Dynamic Drag:
                // We will calculate the 'new time' based on the CURRENT segment's top,
                // and then project the full duration from that new start time.

                // Update initialHeight to be the FULL duration height for calculation purposes
                this.initialHeight = fullHeight;
            }
        }

        const logicalTop = this.initialTop - 1;
        const logicalHeight = this.initialHeight + 3;
        this.initialBottom = logicalTop + logicalHeight;

        const dayCol = el.closest('.day-timeline-column') as HTMLElement;
        this.currentDayDate = dayCol ? dayCol.dataset.date || null : (task.startDate || null);

        this.hasKeyMoved = false;
        this.isOutsideSection = false;

        this.scrollContainer = context.container.querySelector('.timeline-scroll-area') as HTMLElement;

        // Visual feedback
        el.addClass('is-dragging');

        // In move mode, we hide ALL segments of this task (for split tasks)
        // because the GhostManager will handle ALL visualization
        if (this.mode === 'move') {
            const originalId = (task as any).originalTaskId || task.id;
            console.log(`[TimelineDragStrategy] Hiding segments for originalId: ${originalId}`);

            // Query for both direct ID matches and split segments using the original ID
            const selector = `.task-card[data-id="${originalId}"], .task-card[data-split-original-id="${originalId}"]`;
            const allSegments = context.container.querySelectorAll(selector);

            console.log(`[TimelineDragStrategy] Found ${allSegments.length} segments to hide`);

            allSegments.forEach(segment => {
                if (segment instanceof HTMLElement) {
                    segment.style.opacity = '0';
                    this.hiddenElements.push(segment);
                }
            });
            // Ensure the main dragEl is also hidden (it should be in the list above, but just in case)
            el.style.opacity = '0';
        } else {
            el.style.zIndex = '1000';
        }
    }

    onMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;
        this.currentContext = context;
        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;

        const deltaY = e.clientY - this.initialY;

        // Threshold check
        if (!this.hasKeyMoved && Math.abs(deltaY) < 5) return;
        this.hasKeyMoved = true;

        this.processDragMove(e.clientX, e.clientY);
        this.checkAutoScroll(e.clientY);
    }

    private processDragMove(clientX: number, clientY: number) {
        if (!this.dragTask || !this.dragEl || !this.currentContext || !this.ghostManager) return;
        const context = this.currentContext;

        const zoomLevel = context.plugin.settings.zoomLevel;
        const snapPixels = 15 * zoomLevel;

        // 1. Find Current Day Column (for visual snapping reference)
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(clientX, clientY);
        let dayCol = elBelow?.closest('.day-timeline-column') as HTMLElement;

        // Fallback
        if (!dayCol && this.dragEl.parentElement?.classList.contains('day-timeline-column')) {
            dayCol = this.dragEl.parentElement as HTMLElement;
        }

        if (this.mode === 'move') {
            // --- DYNAMIC SPLIT RENDER LOGIC ---

            // Calculate Target Start Time based on mouse position
            let snappedTop = 0;

            // Need to define these before use in anchor logic
            const startHour = context.plugin.settings.startHour;
            const startHourMinutes = startHour * 60;
            const durationMinutes = this.initialHeight / zoomLevel;

            let totalStartMinutes = 0;
            let totalEndMinutes = 0;

            if (dayCol) {
                const rect = dayCol.getBoundingClientRect();
                const yInContainer = clientY - rect.top;

                // Update current reference date if changed column
                if (dayCol.dataset.date) {
                    this.currentDayDate = dayCol.dataset.date;
                }

                if (this.anchorType === 'end') {
                    // END ANCHOR (Bottom-based)
                    // Calculate visual Bottom
                    const rawBottom = yInContainer + this.dragOffsetBottom;
                    const snappedBottom = Math.round(rawBottom / snapPixels) * snapPixels;
                    snappedTop = snappedBottom - this.initialHeight; // Determine top implicitly for some calculations

                    // Visual End Minutes (0 = StartHour)
                    const visualEndMinutes = (snappedBottom / zoomLevel);
                    // Total End = StartHour + VisualEnd
                    const totalEndMinutesCalc = startHourMinutes + visualEndMinutes;
                    // Total Start = Total End - Duration
                    totalStartMinutes = totalEndMinutesCalc - durationMinutes;
                    totalEndMinutes = totalEndMinutesCalc;

                } else {
                    // START ANCHOR (Top-based) - Standard
                    const rawTop = yInContainer - this.dragOffsetY;
                    snappedTop = Math.round(rawTop / snapPixels) * snapPixels;

                    const visualStartMinutes = (snappedTop / zoomLevel);
                    totalStartMinutes = startHourMinutes + visualStartMinutes;
                    totalEndMinutes = totalStartMinutes + durationMinutes;
                }

            } else {
                // If out of column, just extrapolate from initial
                const deltaY = clientY - this.initialY;
                snappedTop = this.initialTop + deltaY;
                snappedTop = Math.round(snappedTop / snapPixels) * snapPixels;

                // Fallback to start-based
                const visualStartMinutes = (snappedTop / zoomLevel);
                totalStartMinutes = startHourMinutes + visualStartMinutes;
                totalEndMinutes = totalStartMinutes + durationMinutes;
            }
            // Generate Ghost Segments
            const segments: GhostSegment[] = [];

            // We need to map time ranges to [Date, Top, Height]
            const dayMinutes = 24 * 60;

            // Normalize currentDayDate object
            const baseDate = new Date(this.currentDayDate!);
            const baseDateObj = new Date(this.currentDayDate + 'T00:00:00');

            // Calculate Start Date/Time for Result Storage (WYSIWYG)
            const startDateObj = new Date(baseDateObj.getTime() + totalStartMinutes * 60000);
            const endDateObj = new Date(startDateObj.getTime() + durationMinutes * 60000); // Derive end from start+duration to ensure consistency (except explicit end anchor logic?)
            // Actually, for End-Anchor, we calculated totalEnd. Let's use that if available?
            // consistency check: totalStart = totalEnd - duration. Yes.

            const newStartDate = DateUtils.getLocalDateString(startDateObj);
            const newStartTime = `${startDateObj.getHours().toString().padStart(2, '0')}:${startDateObj.getMinutes().toString().padStart(2, '0')}`;
            const newEndDate = DateUtils.getLocalDateString(endDateObj);
            const newEndTime = `${endDateObj.getHours().toString().padStart(2, '0')}:${endDateObj.getMinutes().toString().padStart(2, '0')}`;

            this.lastDragResult = {
                startDate: newStartDate,
                startTime: newStartTime,
                endDate: newEndDate,
                endTime: newEndTime
            };

            // Calculate start and end normalized to baseDate's midnight (00:00)
            // If totalStartMinutes < 0, it means previous day relative to 00:00?
            // No, totalStartMinutes is e.g. 5*60 + (-60) = 240 (04:00).
            // So 0..1440 represents 00:00 to 24:00 of the baseDate.

            // Handle splitting.
            // Boundaries are at StartHour of each day.
            // StartHour of baseDate = startHourMinutes.
            // StartHour of nextDay = startHourMinutes + 1440.
            // StartHour of prevDay = startHourMinutes - 1440.

            // We check overlaps with day windows.
            // Window 0 (Current): [startHourMinutes, startHourMinutes + 1440)
            // Window -1 (Prev):   [startHourMinutes - 1440, startHourMinutes)
            // Window +1 (Next):   [startHourMinutes + 1440, startHourMinutes + 2880)

            const checkWindow = (offsetDays: number) => {
                const windowStart = startHourMinutes + (offsetDays * 1440);
                const windowEnd = windowStart + 1440;

                // Intersection logic
                const overlapStart = Math.max(totalStartMinutes, windowStart);
                const overlapEnd = Math.min(totalEndMinutes, windowEnd);

                if (overlapStart < overlapEnd) {
                    // Has overlap
                    const segHeightMinutes = overlapEnd - overlapStart;
                    const segTopMinutes = overlapStart - windowStart; // Relative to window start (StartHour)

                    // Convert back to pixels
                    // Top relative to column (0 = StartHour)
                    // Note: windowStart IS the StartHour for that day
                    // So segTopMinutes * zoomLevel IS the top px

                    const segDate = DateUtils.addDays(this.currentDayDate!, offsetDays);

                    segments.push({
                        date: segDate,
                        top: segTopMinutes * zoomLevel,
                        height: segHeightMinutes * zoomLevel
                    });
                }
            };

            // Check previous, current, next days (covers most drag scenarios)
            checkWindow(-1);
            checkWindow(0);
            checkWindow(1);

            // Render Ghosts
            // We pass dragEl to clone styles from
            this.ghostManager.update(segments, this.dragEl);

        } else {
            // RESIZE MODE - Use existing simple rendering logic (direct manipulation)
            const rect = dayCol ? dayCol.getBoundingClientRect() : this.dragEl.getBoundingClientRect();
            // Just ensure dragEl is visible for resize
            this.dragEl.style.opacity = '1';

            if (!dayCol) return;

            const yInContainer = clientY - rect.top;
            const snappedMouseY = Math.round(yInContainer / snapPixels) * snapPixels;

            if (this.mode === 'resize-bottom') {
                const logicalTop = this.initialTop - 1;
                const newHeight = Math.max(snapPixels, snappedMouseY - logicalTop);
                this.dragEl.style.height = `${newHeight - 3}px`;
            } else if (this.mode === 'resize-top') {
                const currentBottom = this.initialBottom;
                const newTop = snappedMouseY;
                // We don't clamp newTop to 0 anymore to allow negative resize if needed/supported later,
                // but for simple resize, keeping within day is usually safer UI-wise unless we do dynamic resize ghosts too.
                // For now, let's allow negative but clamping physics might be weird without ghost manager.
                // Let's stick to simple resize for V1.
                const clampedHeight = Math.max(snapPixels, currentBottom - newTop);
                const finalTop = currentBottom - clampedHeight;

                this.dragEl.style.top = `${finalTop + 1}px`;
                this.dragEl.style.height = `${clampedHeight - 3}px`;
            }
        }

        // Highlight drop zone
        if (this.mode === 'move') {
            this.updateDropZoneHighlight(clientX, clientY, context);
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        document.body.style.cursor = '';

        if (!this.dragTask || !this.dragEl || !this.currentDayDate || !this.ghostManager) return;

        // Cleanup
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        this.ghostManager.clear();
        this.ghostManager = null;
        this.stopAutoScroll();

        this.dragEl.removeClass('is-dragging');
        this.dragEl.style.zIndex = '';
        this.dragEl.removeClass('is-dragging');
        this.dragEl.style.zIndex = '';

        // Restore all hidden elements
        this.hiddenElements.forEach(el => el.style.opacity = '');
        this.hiddenElements = [];

        this.dragEl.style.opacity = ''; // Restore visibility of main el just in case
        this.currentContext = null;

        if (!this.hasKeyMoved) {
            context.onTaskClick(this.dragTask.id);
            this.dragTask = null;
            this.dragEl = null;
            return;
        }

        // ... (Drop Logic - same as before, handling Future Section drop) ...
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
        if (elBelow) {
            const futureSection = elBelow.closest('.future-section-grid') || elBelow.closest('.future-section__content');
            if (futureSection) {
                // Future logic...
                if (this.dragTask.deadline) {
                    new Notice('DeadlineがあるタスクはFutureに移動できません');
                    this.dragTask = null;
                    return;
                }
                const updates: Partial<Task> = {
                    isFuture: true,
                    startDate: undefined, startTime: undefined, endDate: undefined, endTime: undefined
                };
                await context.taskIndex.updateTask(this.dragTask.id, updates);
                this.dragTask = null;
                return;
            }
        }

        // Regular timeline movement/resize
        const originalId = (this.dragTask as any).originalTaskId || this.dragTask.id;
        const originalTask = context.taskIndex.getTask(originalId);

        if (!originalTask) {
            this.dragTask = null;
            this.dragEl = null;
            return;
        }

        const updates: Partial<Task> = {};

        if (this.mode === 'move') {
            if (this.lastDragResult) {
                updates.startDate = this.lastDragResult.startDate;
                updates.startTime = this.lastDragResult.startTime;
                updates.endDate = this.lastDragResult.endDate;
                updates.endTime = this.lastDragResult.endTime;
            } else {
                // Fallback if no move happened or something went wrong
                // Re-calculate using original logic (should rarely be hit if hasKeyMoved is check correctly)
                console.warn('[TimelineDragStrategy] No lastDragResult found, falling back to basic calculation');
                // ... fallback calculation logic or just return?
                // Given hasKeyMoved check above, this might happen only on simple clicks treated as drags?
                // But hasKeyMoved protects against simple clicks.

                // Let's keep the re-calculation logic alive as fallback or just use what we have?
                // If we trust lastDragResult, we don't need the complex block below. 
                // But for RESIZE mode, processDragMove is NOT populating lastDragResult (it skips that block).
                // So we need to separate paths clearly.

                // If we are here, mode is 'move'. lastDragResult SHOULD exist.
                // If not, maybe we didn't move enough?
                return;
            }
        } else {
            // Re-calculate for Resize (or implement lastDragResult for resize too? - Let's keep resize logic separate for now as it works)

            // ... Need to re-build calculation for Resize ...
            if (!originalTask) return; // Should be checked

            // For RESIZE mode, we DID update dragEl, so we can read from it.
            const zoomLevel = context.plugin.settings.zoomLevel;
            const diffTop = parseInt(this.dragEl.style.top || '0');
            const startHour = context.plugin.settings.startHour;
            const startHourMinutes = startHour * 60;
            const visualStartMinutes = (diffTop / zoomLevel); // 0 at StartHour
            const totalStartMinutes = startHourMinutes + visualStartMinutes;

            let height = parseInt(this.dragEl.style.height || '0');
            const durationMinutes = height / zoomLevel;
            // ... Date conversion ...

            const baseDateObj = new Date(this.currentDayDate + 'T00:00:00');
            const startDateObj = new Date(baseDateObj.getTime() + totalStartMinutes * 60000);
            const endDateObj = new Date(startDateObj.getTime() + durationMinutes * 60000);

            const newStartDate = DateUtils.getLocalDateString(startDateObj);
            const newStartTime = `${startDateObj.getHours().toString().padStart(2, '0')}:${startDateObj.getMinutes().toString().padStart(2, '0')}`;
            const newEndDate = DateUtils.getLocalDateString(endDateObj);
            const newEndTime = `${endDateObj.getHours().toString().padStart(2, '0')}:${endDateObj.getMinutes().toString().padStart(2, '0')}`;

            if (this.mode === 'resize-top') {
                updates.startDate = newStartDate;
                updates.startTime = newStartTime;
                updates.endDate = originalTask.endDate;
                updates.endTime = originalTask.endTime;
            } else if (this.mode === 'resize-bottom') {
                updates.startDate = originalTask.startDate;
                updates.startTime = originalTask.startTime;
                updates.endDate = newEndDate;
                updates.endTime = newEndTime;
            }
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

        document.body.style.cursor = '';

        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        if (!elBelow) return;

        const futureSection = elBelow.closest('.future-section-grid') || elBelow.closest('.future-section__content');

        if (futureSection) {
            if (this.dragTask?.deadline) {
                document.body.style.cursor = 'not-allowed';
            } else {
                let targetEl = futureSection;
                // Try to target content area
                const content = futureSection.closest('.future-section__content') || futureSection.querySelector('.future-section__content');
                if (content) targetEl = content as HTMLElement;

                targetEl.addClass('drag-over');
                this.lastHighlighted = targetEl as HTMLElement;
            }
        }
    }

    private checkAutoScroll(mouseY: number): void {
        if (!this.scrollContainer) return;
        const rect = this.scrollContainer.getBoundingClientRect();
        const scrollThreshold = 50;
        const scrollSpeed = 10;

        let shouldScrollUp = false;
        let shouldScrollDown = false;

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
        if (this.autoScrollTimer !== null) return;
        this.autoScrollTimer = window.setInterval(() => {
            if (!this.scrollContainer) return;
            this.scrollContainer.scrollTop += direction;
            this.processDragMove(this.lastClientX, this.lastClientY); // Re-process drag with new scroll pos
            if (direction < 0 && this.scrollContainer.scrollTop <= 0) {
                this.stopAutoScroll();
            } else if (direction > 0 &&
                this.scrollContainer.scrollTop >=
                this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight) {
                this.stopAutoScroll();
            }
        }, 16);
    }

    private stopAutoScroll(): void {
        if (this.autoScrollTimer !== null) {
            clearInterval(this.autoScrollTimer);
        }
    }
}
