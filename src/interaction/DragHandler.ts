import { TaskIndex } from '../services/TaskIndex';
import { Task } from '../types';
import TaskViewerPlugin from '../main';

export class DragHandler {
    private container: HTMLElement;
    private taskIndex: TaskIndex;
    private plugin: TaskViewerPlugin;
    private dragTask: Task | null = null;
    private dragEl: HTMLElement | null = null;
    private initialY: number = 0;
    private initialX: number = 0;
    private initialTop: number = 0;
    private initialHeight: number = 0;
    private initialBottom: number = 0;
    private dragOffsetY: number = 0;
    private isDragging: boolean = false;
    private mode: 'move' | 'resize-top' | 'resize-bottom' | null = null;
    private onTaskClick: (taskId: string) => void;
    private onTaskMove: () => void;
    private dragThreshold: number = 5;
    private hasMoved: boolean = false;
    private currentDayDate: string | null = null;
    private isOverAllDay: boolean = false;
    private lockedAllDayRow: HTMLElement | null = null;

    private boundPointerDown: (e: PointerEvent) => void;
    private boundPointerMove: (e: PointerEvent) => void;
    private boundPointerUp: (e: PointerEvent) => void;
    private currentDoc: Document;

    private autoScrollSpeed: number = 0;
    private autoScrollFrameId: number | null = null;

    constructor(container: HTMLElement, taskIndex: TaskIndex, plugin: TaskViewerPlugin, onTaskClick: (taskId: string) => void, onTaskMove: () => void) {
        this.container = container;
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.onTaskClick = onTaskClick;
        this.onTaskMove = onTaskMove;

        this.boundPointerDown = this.onPointerDown.bind(this);
        this.boundPointerMove = this.onPointerMove.bind(this);
        this.boundPointerUp = this.onPointerUp.bind(this);

        this.container.addEventListener('pointerdown', this.boundPointerDown);

        // Initialize with current ownerDocument
        this.currentDoc = this.container.ownerDocument || document;
        this.currentDoc.addEventListener('pointermove', this.boundPointerMove);
        this.currentDoc.addEventListener('pointerup', this.boundPointerUp);
    }

    destroy() {
        this.container.removeEventListener('pointerdown', this.boundPointerDown);
        if (this.currentDoc) {
            this.currentDoc.removeEventListener('pointermove', this.boundPointerMove);
            this.currentDoc.removeEventListener('pointerup', this.boundPointerUp);
        }
        this.stopAutoScrollLoop();
    }

    private onPointerDown(e: PointerEvent) {
        // Check if document has changed (e.g. view moved to new window)
        const newDoc = this.container.ownerDocument || document;
        if (newDoc !== this.currentDoc) {
            this.currentDoc.removeEventListener('pointermove', this.boundPointerMove);
            this.currentDoc.removeEventListener('pointerup', this.boundPointerUp);

            this.currentDoc = newDoc;
            this.currentDoc.addEventListener('pointermove', this.boundPointerMove);
            this.currentDoc.addEventListener('pointerup', this.boundPointerUp);
        }

        const target = e.target as HTMLElement;

        // Check for handle click first (detached handles)
        const handle = target.closest('.handle-btn') as HTMLElement;
        let taskEl: HTMLElement | null = null;
        let taskId: string | null = null;

        if (handle) {
            taskId = handle.dataset.taskId || null;
            if (taskId) {
                taskEl = this.container.querySelector(`.task-card[data-id="${taskId}"]`) as HTMLElement;
            }
        } else {
            // Normal task click
            taskEl = target.closest('.task-card') as HTMLElement;
            if (taskEl) {
                taskId = taskEl.dataset.id || null;
            }
        }

        if (!taskEl || !taskId) return;

        const task = this.taskIndex.getTasks().find(t => t.id === taskId);
        if (!task) return;

        // Detect Mode
        if (target.closest('.top-resize-handle')) {
            this.mode = 'resize-top';
            e.preventDefault();
            e.stopPropagation();
        } else if (target.closest('.bottom-resize-handle')) {
            this.mode = 'resize-bottom';
            e.preventDefault();
            e.stopPropagation();
        } else if (target.closest('.move-handle')) {
            this.mode = 'move';
            e.preventDefault();
            e.stopPropagation();
        } else {
            // Body click - do NOT set mode, so no drag will occur
            this.mode = null;
        }

        this.prepareDrag(task, taskEl, e);
    }

    private prepareDrag(task: Task, el: HTMLElement, e: PointerEvent) {
        this.dragTask = task;
        this.dragEl = el;
        this.initialX = e.clientX;
        this.initialY = e.clientY;
        this.initialTop = parseInt(el.style.top || '0');
        this.initialHeight = parseInt(el.style.height || '0');

        // Calculate logical bottom once at start
        // Logical Top = Visual Top - 1
        // Logical Height = Visual Height + 3
        const logicalTop = this.initialTop - 1;
        const logicalHeight = this.initialHeight + 3;
        this.initialBottom = logicalTop + logicalHeight;

        const rect = el.getBoundingClientRect();
        this.dragOffsetY = e.clientY - rect.top;

        const dayCol = el.closest('.day-timeline-column') as HTMLElement;
        if (dayCol && dayCol.dataset.date) {
            this.currentDayDate = dayCol.dataset.date;
        } else {
            this.currentDayDate = task.date;
        }
        this.isDragging = false;
        this.hasMoved = false;
        this.isOverAllDay = !task.startTime; // Initialize based on current task state

        this.isOverAllDay = !task.startTime; // Initialize based on current task state
    }

    private onPointerMove(e: PointerEvent) {
        if (!this.dragTask || !this.dragEl) return;

        const deltaX = e.clientX - this.initialX;
        const deltaY = e.clientY - this.initialY;

        // Check movement threshold
        if (Math.abs(deltaX) > this.dragThreshold || Math.abs(deltaY) > this.dragThreshold) {
            this.hasMoved = true;

            // Only start dragging if we have a mode (handle was clicked)
            if (this.mode && !this.isDragging) {
                this.isDragging = true;
                this.dragEl.addClass('is-dragging');

                // Lock All-Day Row Height to prevent jumping when dragging out
                const allDayRows = this.container.getElementsByClassName('all-day-row');
                if (allDayRows.length > 0) {
                    const allDayRow = allDayRows[0] as HTMLElement;
                    this.lockedAllDayRow = allDayRow;
                    // Set min-height to current computed height to prevent shrinking,
                    // but allow expanding if content grows.
                    const currentHeight = allDayRow.offsetHeight;
                    allDayRow.style.minHeight = `${currentHeight}px`;
                }
            }
        }

        if (!this.isDragging) return;

        e.preventDefault(); // Prevent scrolling/selection while dragging

        // Snap deltaY to 15 minutes (15px * zoomLevel)
        const zoomLevel = this.plugin.settings.zoomLevel;
        const snapPixels = 15 * zoomLevel;
        const snappedDeltaY = Math.round(deltaY / snapPixels) * snapPixels;

        // --- Cross-Day & All-Day Logic ---
        const doc = this.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);

        // 1. Check All-Day Area
        // DISABLED: User requested to disable implicit conversion from Timed to All-Day via drag
        const allDayCell = elBelow?.closest('.all-day-cell') as HTMLElement;
        // Check if it's a valid day cell (has date) and NOT the time axis cell
        if (allDayCell && allDayCell.dataset.date) {
            // ONLY allow if it's ALREADY an all-day task (prevent implicit conversion from timed)
            if (!this.dragTask.startTime) {
                if (this.dragEl.parentElement !== allDayCell) {
                    allDayCell.appendChild(this.dragEl);
                    this.currentDayDate = allDayCell.dataset.date || null;
                    this.isOverAllDay = true;

                    // Update Classes
                    this.dragEl.addClass('all-day');
                    this.dragEl.removeClass('timed');

                    // Reset styles for all-day (stacked)
                    this.dragEl.style.top = '';
                    this.dragEl.style.height = '';
                    this.dragEl.style.position = 'relative';
                    this.dragEl.style.width = ''; // Let it fill
                }
                this.onTaskMove(); // Update handles
                return; // Skip timeline positioning logic
            }
        }

        // 2. Check Timeline Area
        let dayCol = elBelow?.closest('.day-timeline-column') as HTMLElement;

        // Fallback: If not over a column, but we are dragging a timed task, use the current parent column
        // This handles cases where the mouse moves quickly outside the column (e.g. to the edges)
        if (!dayCol && this.isDragging && !this.isOverAllDay && this.dragEl && this.dragEl.parentElement) {
            const parent = this.dragEl.parentElement;
            if (parent.classList.contains('day-timeline-column')) {
                dayCol = parent as HTMLElement;
            }
        }

        if (dayCol) {
            if (this.dragEl.parentElement !== dayCol) {
                dayCol.appendChild(this.dragEl);
                this.currentDayDate = dayCol.dataset.date || null;
                this.isOverAllDay = false;

                // Update Classes
                this.dragEl.removeClass('all-day');
                this.dragEl.addClass('timed');

                // Restore styles for timeline (absolute)
                this.dragEl.style.position = 'absolute';
                this.dragEl.style.width = 'calc(100% - 8px)';
                this.dragEl.style.left = '4px';
            }

            // Calculate new top based on mouse position relative to the column
            const rect = dayCol.getBoundingClientRect();
            const yInContainer = e.clientY - rect.top;
            const zoomLevel = this.plugin.settings.zoomLevel;
            const snapPixels = 15 * zoomLevel;
            const snappedMouseY = Math.round(yInContainer / snapPixels) * snapPixels;

            if (this.mode === 'move') {
                // Use offset to keep mouse relative position constant
                const rawTop = yInContainer - this.dragOffsetY;
                const snappedTop = Math.round(rawTop / snapPixels) * snapPixels;

                // Clamp to day boundaries (0 to 24h)
                // 24h * 60min = 1440px
                // We need to check against logical height
                // Visual height is logical height - 3
                const currentHeight = parseInt(this.dragEl.style.height || `${60 * zoomLevel}`);
                const logicalHeight = currentHeight + 3;

                const maxTop = (1440 * zoomLevel) - logicalHeight;
                const clampedTop = Math.max(0, Math.min(maxTop, snappedTop));

                // Apply visual offset: top + 1
                this.dragEl.style.top = `${clampedTop + 1}px`;

                // Ensure height exists if coming from all-day
                if (!this.dragEl.style.height || this.dragEl.style.height === 'auto' || this.dragEl.style.height === '') {
                    this.dragEl.style.height = `${(60 * zoomLevel) - 3}px`; // Default 1 hour - 3px
                }
            } else if (this.mode === 'resize-bottom') {
                // Use initial logical top (fixed anchor)
                const logicalTop = this.initialTop - 1;

                const newHeight = Math.max(snapPixels, snappedMouseY - logicalTop);

                // Clamp height so it doesn't exceed 24h
                const maxHeight = (1440 * zoomLevel) - logicalTop;
                const clampedHeight = Math.min(newHeight, maxHeight);

                // Apply visual offset: height - 3
                this.dragEl.style.height = `${clampedHeight - 3}px`;
            } else if (this.mode === 'resize-top') {
                // Use initial logical bottom (fixed anchor)
                const currentBottom = this.initialBottom;
                const newTop = Math.max(0, snappedMouseY);

                // Clamp top to 0
                const clampedTop = Math.max(0, newTop);
                // Recalculate height based on clamped top
                const clampedHeight = Math.max(snapPixels, currentBottom - clampedTop);

                // Apply visual offsets
                this.dragEl.style.top = `${clampedTop + 1}px`;
                this.dragEl.style.height = `${clampedHeight - 3}px`;
            }
        }

        // --- Auto-Scroll Logic ---
        this.handleAutoScroll(e.clientY);

        this.onTaskMove(); // Update handles
    }

    private handleAutoScroll(clientY: number) {
        const scrollArea = this.container.querySelector('.timeline-scroll-area');
        if (!scrollArea) return;

        const scrollRect = scrollArea.getBoundingClientRect();
        const scrollThreshold = 50; // px from edge
        const maxSpeed = 15; // px per frame

        if (clientY < scrollRect.top + scrollThreshold) {
            // Scroll Up
            // Speed increases as we get closer to the edge
            const distance = Math.max(0, (scrollRect.top + scrollThreshold) - clientY);
            const ratio = Math.min(1, distance / scrollThreshold);
            this.autoScrollSpeed = -maxSpeed * ratio;
        } else if (clientY > scrollRect.bottom - scrollThreshold) {
            // Scroll Down
            const distance = Math.max(0, clientY - (scrollRect.bottom - scrollThreshold));
            const ratio = Math.min(1, distance / scrollThreshold);
            this.autoScrollSpeed = maxSpeed * ratio;
        } else {
            this.autoScrollSpeed = 0;
        }

        if (this.autoScrollSpeed !== 0 && this.autoScrollFrameId === null) {
            this.startAutoScrollLoop();
        } else if (this.autoScrollSpeed === 0 && this.autoScrollFrameId !== null) {
            this.stopAutoScrollLoop();
        }
    }

    private startAutoScrollLoop() {
        const loop = () => {
            if (this.autoScrollSpeed === 0) {
                this.stopAutoScrollLoop();
                return;
            }

            const scrollArea = this.container.querySelector('.timeline-scroll-area');
            if (scrollArea) {
                const startScrollTop = scrollArea.scrollTop;
                scrollArea.scrollTop += this.autoScrollSpeed;
                const actualScroll = scrollArea.scrollTop - startScrollTop;

                // Update drag element position ONLY if we actually scrolled
                if (actualScroll !== 0 && this.dragEl && this.mode === 'move') {
                    const currentTop = parseInt(this.dragEl.style.top || '0');
                    const newTop = currentTop + actualScroll;

                    // Clamp to day boundaries (0 to 24h)
                    const zoomLevel = this.plugin.settings.zoomLevel;
                    const maxTop = (1440 * zoomLevel) - (parseInt(this.dragEl.style.height || `${60 * zoomLevel}`));
                    const clampedTop = Math.max(0, Math.min(maxTop, newTop));

                    this.dragEl.style.top = `${clampedTop}px`;
                }

                this.onTaskMove(); // Update handles
            }

            this.autoScrollFrameId = requestAnimationFrame(loop);
        };
        this.autoScrollFrameId = requestAnimationFrame(loop);
    }

    private stopAutoScrollLoop() {
        if (this.autoScrollFrameId !== null) {
            cancelAnimationFrame(this.autoScrollFrameId);
            this.autoScrollFrameId = null;
        }
    }

    private onPointerUp(e: PointerEvent) {
        this.stopAutoScrollLoop(); // Stop scrolling on release

        if (!this.dragTask || !this.dragEl) return;

        if (!this.isDragging) {
            // It was a click
            // Only trigger click if we didn't move significantly
            if (!this.hasMoved) {
                this.onTaskClick(this.dragTask.id);
            }
        } else {
            // It was a drag
            this.finalizeDrag();
        }

        // Cleanup
        this.dragEl.removeClass('is-dragging');
        this.dragTask = null;
        this.dragEl = null;
        this.isDragging = false;
        this.mode = null;
        this.hasMoved = false;

        // Unlock All-Day Row Height
        if (this.lockedAllDayRow) {
            this.lockedAllDayRow.style.minHeight = '';
            this.lockedAllDayRow = null;
        }
    }

    private async finalizeDrag() {
        if (!this.dragTask || !this.dragEl || !this.currentDayDate) return;

        const updates: Partial<Task> = {};

        // 1. Date Update - MOVED inside specific blocks
        // if (this.currentDayDate !== this.dragTask.date) {
        //     updates.date = this.currentDayDate;
        // }

        // 2. Time Update
        if (this.isOverAllDay) {
            // Converted to All-Day
            if (this.currentDayDate !== this.dragTask.date) {
                updates.date = this.currentDayDate;
            }
            if (this.dragTask.startTime) {
                updates.startTime = undefined;
                updates.endTime = undefined;
            }
        } else {
            // Converted to Timed or Moved/Resized in Timed
            // Parse raw visual values
            const top = parseInt(this.dragEl.style.top || '0');
            const zoomLevel = this.plugin.settings.zoomLevel;
            const height = parseInt(this.dragEl.style.height || `${60 * zoomLevel}`);

            // Reverse visual adjustments to get logical values:
            // TimelineView adds 1px to top, so we subtract 1px
            // TimelineView subtracts 3px from height, so we add 3px
            const logicalTop = top - 1;
            const logicalHeight = height + 3;

            // Calculate time based on startHour
            const startHour = this.plugin.settings.startHour;
            const startHourMinutes = startHour * 60;

            // Total minutes from midnight of the VISUAL day
            // Convert visual pixels back to minutes: pixels / zoomLevel
            const startTotalMinutes = (logicalTop / zoomLevel) + startHourMinutes;
            const endTotalMinutes = startTotalMinutes + (logicalHeight / zoomLevel);

            // Determine actual calendar date and time
            let finalDate = this.currentDayDate;
            let finalStartMinutes = startTotalMinutes;
            let finalEndMinutes = endTotalMinutes;

            // If start time is >= 24h, it belongs to next day
            if (startTotalMinutes >= 24 * 60) {
                // Next day
                const d = new Date(this.currentDayDate);
                d.setDate(d.getDate() + 1);
                finalDate = d.toISOString().split('T')[0];

                finalStartMinutes = startTotalMinutes - 24 * 60;
                finalEndMinutes = endTotalMinutes - 24 * 60;

                // If date changed, update it
                if (finalDate !== this.dragTask.date) {
                    updates.date = finalDate;
                }
            } else {
                // Current day
                // Ensure date is set to visual day
                if (this.currentDayDate !== this.dragTask.date) {
                    updates.date = this.currentDayDate;
                }
            }

            // Format times
            const newStartTime = this.minutesToTime(finalStartMinutes);
            let newEndTime: string;

            // Check if end time spans to next day (relative to finalDate)
            // finalEndMinutes is relative to finalDate's 00:00
            if (finalEndMinutes >= 24 * 60) {
                // End time is on the next day
                const endDateObj = new Date(finalDate);
                endDateObj.setDate(endDateObj.getDate() + 1);
                const endDateStr = endDateObj.toISOString().split('T')[0];

                // Normalize minutes for time string
                const normalizedEndMinutes = finalEndMinutes - 24 * 60;
                const endTimeStr = this.minutesToTime(normalizedEndMinutes);

                newEndTime = `${endDateStr}T${endTimeStr}`;
            } else {
                // End time is on the same day
                newEndTime = this.minutesToTime(finalEndMinutes);
            }

            if (newStartTime !== this.dragTask.startTime || newEndTime !== this.dragTask.endTime) {
                updates.startTime = newStartTime;
                updates.endTime = newEndTime;
            }
        }

        if (Object.keys(updates).length > 0) {
            await this.taskIndex.updateTask(this.dragTask.id, updates);
        }
    }

    private minutesToTime(minutes: number): string {
        // Normalize minutes to 0-23h range (just in case)
        let m = Math.round(minutes);
        if (m < 0) m = 0;

        // Handle wrap for display/storage
        while (m >= 24 * 60) {
            m -= 24 * 60;
        }

        const h = Math.floor(m / 60);
        const min = m % 60;
        return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    }
}
