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
    private dragTimeOffset: number = 0; // NEW: Time difference (minutes) between mouse and anchor time
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
        // Also support explicit bottom-right handle click
        if (target.closest('.task-card__handle--move-bottom-right')) {
            this.anchorType = 'end';
            console.log('[TimelineDragStrategy] Anchor: END (bottom-right handle)');
        } else if (target.closest('.task-card__handle--move-top-right')) {
            this.anchorType = 'start';
            console.log('[TimelineDragStrategy] Anchor: START (top-right handle)');
        } else {
            // Fallback for unexpected cases or legacy
            if (el.classList.contains('task-card--split-after')) {
                this.anchorType = 'end';
            } else {
                this.anchorType = 'start';
            }
            console.log(`[TimelineDragStrategy] Anchor: ${this.anchorType.toUpperCase()} (fallback)`);
        }

        // 2. Expand Split Task on Move (Virtual Expansion using Original Task Logic)
        // For split tasks, we need to calculate visual position based on the ORIGINAL task's times,
        // not the segment's visual position (which would cause jumps when dragging)
        let originalTaskStartMinutes: number | null = null;
        let originalTaskEndMinutes: number | null = null;

        const dayCol = el.closest('.day-timeline-column') as HTMLElement;
        this.currentDayDate = dayCol ? dayCol.dataset.date || null : (task.startDate || null);

        const zoomLevel = context.plugin.settings.zoomLevel;
        const startHour = context.plugin.settings.startHour;
        const startHourMinutes = startHour * 60;

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
                const fullHeight = durationMinutes * zoomLevel;

                // Update initialHeight to be the FULL duration height for calculation purposes
                this.initialHeight = fullHeight;

                // Calculate original task's start/end in minutes relative to currentDayDate's startHour
                // This is needed to correctly calculate dragTimeOffset for split tasks
                if (this.currentDayDate) {
                    const currentDayStart = new Date(`${this.currentDayDate}T00:00:00`);

                    // Calculate start minutes relative to currentDayDate's midnight
                    const startDiffMs = start.getTime() - currentDayStart.getTime();
                    originalTaskStartMinutes = startDiffMs / 60000;

                    // Calculate end minutes relative to currentDayDate's midnight
                    const endDiffMs = end.getTime() - currentDayStart.getTime();
                    originalTaskEndMinutes = endDiffMs / 60000;
                }
            }
        }

        const logicalTop = this.initialTop - 1;
        const logicalHeight = this.initialHeight + 3;
        this.initialBottom = logicalTop + logicalHeight;

        // --- Calculate Time Offset ---
        let mouseMinutes = 0;
        if (dayCol) {
            const dayRect = dayCol.getBoundingClientRect();
            const yInCol = e.clientY - dayRect.top;
            mouseMinutes = startHourMinutes + (yInCol / zoomLevel);
        } else {
            const yInCol = parseInt(el.style.top || '0') + (e.clientY - rect.top);
            mouseMinutes = startHourMinutes + (yInCol / zoomLevel);
        }

        // Calculate visual start/end minutes for dragTimeOffset
        let visualStartMinutes: number;
        let visualEndMinutes: number;

        if (originalTaskStartMinutes !== null && originalTaskEndMinutes !== null) {
            // For split tasks: use original task's actual start/end times
            visualStartMinutes = originalTaskStartMinutes;
            visualEndMinutes = originalTaskEndMinutes;
        } else {
            // For normal tasks: derive from visual position
            const visualTop = this.initialTop;
            const visualHeight = this.initialHeight;
            visualStartMinutes = startHourMinutes + (visualTop / zoomLevel);
            visualEndMinutes = visualStartMinutes + (visualHeight / zoomLevel);
        }

        if (this.anchorType === 'end') {
            this.dragTimeOffset = visualEndMinutes - mouseMinutes; // Positive if mouse is above bottom
        } else {
            this.dragTimeOffset = mouseMinutes - visualStartMinutes; // Positive if mouse is below top
        }


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
                    // segment.style.opacity = '0'; // Delayed until onMove
                    this.hiddenElements.push(segment);
                }
            });
            // Ensure the main dragEl is also hidden (it should be in the list above, but just in case)
            // el.style.opacity = '0'; // Delayed
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
        if (!this.hasKeyMoved) {
            if (Math.abs(deltaY) < 5) return;
            this.hasKeyMoved = true;

            // Apply hiding now that we are actually moving
            if (this.mode === 'move') {
                this.hiddenElements.forEach(el => el.style.opacity = '0');
                if (this.dragEl) this.dragEl.style.opacity = '0';
            }
        }

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
                    // New End Time = Mouse + Offset
                    // We calculate minutes relative to StartHour (window start) for snapping
                    // actually mouseMinutes includes StartHour.

                    const rect = dayCol.getBoundingClientRect();
                    const yInContainer = clientY - rect.top;
                    const mouseMinutes = startHourMinutes + (yInContainer / zoomLevel);

                    const rawEndMinutes = mouseMinutes + this.dragTimeOffset;

                    // SNAP: Round rawEndMinutes to nearest grid interval (15 min)
                    // To do this properly in minutes:
                    const snapInterval = 15;
                    const snappedEndMinutes = Math.round(rawEndMinutes / snapInterval) * snapInterval;

                    // Reconstruct Top/height
                    totalEndMinutes = snappedEndMinutes;
                    totalStartMinutes = totalEndMinutes - durationMinutes;

                    // For ghost positioning (relative to column top 0-based)
                    // Ghost Top = (Start - StartHour) * Zoom
                    // But we used absolute minutes (StartHour included).
                    // So:
                    snappedTop = (totalStartMinutes - startHourMinutes) * zoomLevel;

                } else {
                    // START ANCHOR (Top-based)
                    const rect = dayCol.getBoundingClientRect();
                    const yInContainer = clientY - rect.top;
                    const mouseMinutes = startHourMinutes + (yInContainer / zoomLevel);

                    const rawStartMinutes = mouseMinutes - this.dragTimeOffset;

                    const snapInterval = 15;
                    const snappedStartMinutes = Math.round(rawStartMinutes / snapInterval) * snapInterval;

                    totalStartMinutes = snappedStartMinutes;
                    totalEndMinutes = totalStartMinutes + durationMinutes;

                    snappedTop = (totalStartMinutes - startHourMinutes) * zoomLevel;
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
            // Round to integer minutes to avoid floating-point errors
            const roundedStartMinutes = Math.round(totalStartMinutes);
            const roundedEndMinutes = Math.round(totalEndMinutes);

            // Calculate date offsets from base date (minutes can be negative or >= 1440)
            const startDayOffset = Math.floor(roundedStartMinutes / 1440);
            const endDayOffset = Math.floor(roundedEndMinutes / 1440);

            // Normalize minutes to 0-1439 range for time calculation
            const normalizedStartMinutes = ((roundedStartMinutes % 1440) + 1440) % 1440;
            const normalizedEndMinutes = ((roundedEndMinutes % 1440) + 1440) % 1440;

            const newStartDate = DateUtils.addDays(this.currentDayDate!, startDayOffset);
            const newStartTime = DateUtils.minutesToTime(normalizedStartMinutes);
            const newEndDate = DateUtils.addDays(this.currentDayDate!, endDayOffset);
            const newEndTime = DateUtils.minutesToTime(normalizedEndMinutes);

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

    }

    async onUp(e: PointerEvent, context: DragContext) {
        document.body.style.cursor = '';

        if (!this.dragTask || !this.dragEl || !this.currentDayDate || !this.ghostManager) return;

        // Cleanup highlight
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        // ゴーストマネージャーへの参照を保存（後でクリアするため）
        const ghostManagerToClean = this.ghostManager;
        this.ghostManager = null;
        this.stopAutoScroll();

        this.dragEl.removeClass('is-dragging');
        this.dragEl.style.zIndex = '';

        // hiddenElements参照を保存（updateTask後に使用）
        const elementsToRestore = [...this.hiddenElements];
        const dragElToRestore = this.dragEl;
        this.hiddenElements = [];

        // currentContext = null は updateTask 完了後に設定
        // this.currentContext は後でクリアする

        if (!this.hasKeyMoved) {
            // クリックのみの場合：ゴーストを即座にクリア
            ghostManagerToClean.clear();
            context.onTaskClick(this.dragTask.id);
            this.dragTask = null;
            this.dragEl = null;
            return;
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

            // Calculate logical values (account for CSS offset)
            const logicalTop = diffTop - 1;
            const height = parseInt(this.dragEl.style.height || '0');
            const logicalHeight = height + 3;

            // Calculate total minutes from midnight
            const totalStartMinutes = startHourMinutes + (logicalTop / zoomLevel);
            const totalEndMinutes = totalStartMinutes + (logicalHeight / zoomLevel);

            // Round to integer minutes to avoid floating-point errors
            const roundedStartMinutes = Math.round(totalStartMinutes);
            const roundedEndMinutes = Math.round(totalEndMinutes);

            // Day offset from visual column date (same pattern as move mode)
            const startDayOffset = Math.floor(roundedStartMinutes / 1440);
            const endDayOffset = Math.floor(roundedEndMinutes / 1440);

            const normalizedStartMinutes = ((roundedStartMinutes % 1440) + 1440) % 1440;
            const normalizedEndMinutes = ((roundedEndMinutes % 1440) + 1440) % 1440;

            const newStartDate = DateUtils.addDays(this.currentDayDate!, startDayOffset);
            const newStartTime = DateUtils.minutesToTime(normalizedStartMinutes);
            const newEndDate = DateUtils.addDays(this.currentDayDate!, endDayOffset);
            const newEndTime = DateUtils.minutesToTime(normalizedEndMinutes);

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
            // 復元対象のタスクIDを保存（DOM要素参照ではなくIDで管理）
            const taskIdToRestore = this.dragTask.id;
            const containerRef = context.container;

            await context.taskIndex.updateTask(this.dragTask.id, updates);

            // move/resize完了後も選択状態を維持
            context.onTaskClick(taskIdToRestore);

            // updateTask完了後、DOM更新完了を待ってから新しいDOM要素のopacity復元とゴーストクリア
            // 二重RAFで2フレーム待つことで、レンダリング完了を確実に待つ
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // 新しいDOM要素が表示されてからゴーストをクリア（ちらつき防止）
                    ghostManagerToClean.clear();

                    // 新しいDOMから要素を再取得（古い参照は無効）
                    const selector = `.task-card[data-id="${taskIdToRestore}"], .task-card[data-split-original-id="${taskIdToRestore}"]`;
                    const newElements = containerRef.querySelectorAll(selector);

                    newElements.forEach(el => {
                        if (el instanceof HTMLElement) {
                            el.style.transition = 'none';
                            el.style.opacity = '';
                            // 次フレームでtransitionを復元
                            requestAnimationFrame(() => {
                                el.style.transition = '';
                            });
                        }
                    });
                });
            });
        } else {
            // 更新がない場合はゴーストを即座にクリア
            ghostManagerToClean.clear();
        }

        // ここでcurrentContextをクリア
        this.currentContext = null;
        this.dragTask = null;
        this.dragEl = null;
    }

    private updateDropZoneHighlight(clientX: number, clientY: number, context: DragContext) {
        // No-op (Future section removed)
        document.body.style.cursor = '';
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
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
