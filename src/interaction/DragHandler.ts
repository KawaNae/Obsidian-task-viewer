import { TaskIndex } from '../services/TaskIndex';
import { Task } from '../types';

export class DragHandler {
    private container: HTMLElement;
    private taskIndex: TaskIndex;
    private dragTask: Task | null = null;
    private dragEl: HTMLElement | null = null;
    private initialY: number = 0;
    private initialX: number = 0;
    private initialTop: number = 0;
    private initialHeight: number = 0;
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

    constructor(container: HTMLElement, taskIndex: TaskIndex, onTaskClick: (taskId: string) => void, onTaskMove: () => void) {
        this.container = container;
        this.taskIndex = taskIndex;
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
    }

    private onPointerDown(e: PointerEvent) {
        // Check if document has changed (e.g. view moved to new window)
        const newDoc = this.container.ownerDocument || document;
        if (newDoc !== this.currentDoc) {
            // console.log('DragHandler: Document changed, re-binding listeners');
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

        const rect = el.getBoundingClientRect();
        this.dragOffsetY = e.clientY - rect.top;

        this.currentDayDate = task.date;
        this.isDragging = false;
        this.hasMoved = false;
        this.isOverAllDay = !task.startTime; // Initialize based on current task state

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
                this.dragEl.addClass('dragging');
            }
        }

        if (!this.isDragging) return;

        e.preventDefault(); // Prevent scrolling/selection while dragging

        // Snap deltaY to 15 minutes (15px)
        const snappedDeltaY = Math.round(deltaY / 15) * 15;

        // --- Cross-Day & All-Day Logic ---
        const doc = this.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);

        // 1. Check All-Day Area
        const allDayCell = elBelow?.closest('.all-day-cell') as HTMLElement;
        if (allDayCell) {
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

        // 2. Check Timeline Area
        const dayCol = elBelow?.closest('.day-timeline-column') as HTMLElement;
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
            const snappedMouseY = Math.round(yInContainer / 15) * 15;

            if (this.mode === 'move') {
                // Use offset to keep mouse relative position constant
                const rawTop = yInContainer - this.dragOffsetY;
                const snappedTop = Math.round(rawTop / 15) * 15;
                this.dragEl.style.top = `${Math.max(0, snappedTop)}px`;

                // Ensure height exists if coming from all-day
                if (!this.dragEl.style.height || this.dragEl.style.height === 'auto' || this.dragEl.style.height === '') {
                    this.dragEl.style.height = '60px'; // Default 1 hour
                }
            } else if (this.mode === 'resize-bottom') {
                const currentTop = parseInt(this.dragEl.style.top || '0');
                // If coming from all-day, currentTop might be weird, but we handled move first usually.
                // If resizing from all-day, it's tricky. Let's assume we are in timeline.
                const newHeight = Math.max(15, snappedMouseY - currentTop);
                this.dragEl.style.height = `${newHeight}px`;
            } else if (this.mode === 'resize-top') {
                const currentBottom = parseInt(this.dragEl.style.top || '0') + parseInt(this.dragEl.style.height || '0');
                const newTop = Math.max(0, snappedMouseY);
                const newHeight = Math.max(15, currentBottom - newTop);
                this.dragEl.style.top = `${newTop}px`;
                this.dragEl.style.height = `${newHeight}px`;
            }
        }

        this.onTaskMove(); // Update handles
    }

    private onPointerUp(e: PointerEvent) {
        if (!this.dragTask || !this.dragEl) return;

        if (!this.isDragging) {
            // It was a click
            // Only trigger click if we didn't move significantly
            if (!this.hasMoved) {
                this.onTaskClick(this.dragTask.id);
            }
        } else {
            // Finalize Drag
            this.finalizeDrag();
        }

        this.cleanup();
    }

    private finalizeDrag() {
        if (!this.dragTask || !this.dragEl) return;

        const updates: any = {};

        // Include date update if it changed
        if (this.currentDayDate && this.currentDayDate !== this.dragTask.date) {
            updates.date = this.currentDayDate;
        }

        if (this.isOverAllDay) {
            // Convert to All-Day
            updates.startTime = undefined;
            updates.endTime = undefined;
        } else {
            // Convert to Timed
            const currentTop = parseInt(this.dragEl.style.top || '0');
            const currentHeight = parseInt(this.dragEl.style.height || '0');

            // Convert pixels to time
            // 1px = 1min
            const startMinutes = currentTop;
            const endMinutes = currentTop + currentHeight;

            updates.startTime = this.minutesToTime(startMinutes);
            updates.endTime = this.minutesToTime(endMinutes);
        }

        this.taskIndex.updateTask(this.dragTask.id, updates);
    }

    private cleanup() {
        if (this.dragEl) {
            this.dragEl.removeClass('dragging');
        }

        // Unlock All-Day Row Height
        if (this.lockedAllDayRow) {
            this.lockedAllDayRow.style.minHeight = '';
            this.lockedAllDayRow = null;
        }

        this.dragTask = null;
        this.dragEl = null;
        this.isDragging = false;
        this.mode = null;
        this.currentDayDate = null;
        this.isOverAllDay = false;
    }

    private minutesToTime(minutes: number): string {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
}
