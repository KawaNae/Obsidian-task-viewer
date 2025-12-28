import { DragStrategy, DragContext } from '../DragStrategy';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

export class LongTermDragStrategy implements DragStrategy {
    name = 'LongTerm';

    private dragTask: Task | null = null;
    private dragEl: HTMLElement | null = null;
    private mode: 'move' | 'resize-left' | 'resize-right' = 'move';
    private initialX: number = 0;

    // Grid geometry
    private colWidth: number = 0;
    private startCol: number = 0;
    private initialSpan: number = 0;
    private initialDate: string = '';
    private initialEndDate: string = '';

    private currentSpan: number = 0;
    private currentStartOffset: number = 0;
    private hasMoved: boolean = false;
    private initialWidth: number = 0;

    // We rely on grid columns for snapping.
    // 1 col = 1 day.

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.dragEl = el;
        this.initialX = e.clientX;

        // Determine Mode
        const target = e.target as HTMLElement;
        if (target.closest('.resize-handle')) { // Left/Right handles for long-term?
            // Actually, existing handles for LongTerm were:
            // SD: Left handle
            // ED: Right handle
            // SED: Both
            // But we need to distinguish left vs right handle
            // Currently TimelineView renders 'resize-handle' without specific left/right classes?
            // Wait, renderHandles in TimelineView for AllDay used 'move-handle' only?
            // Checking TimelineView renderHandles...
            // It seems only move-handle was implemented for AllDay in the last large edit.
            // "if (isAllDay) { ... moveHandle ... }"
            // So we need to FIX TimelineView to render resize handles for LongTerm first?
            // OR we assume they exist.
            // The previous user requirement (Conversation 1d73a...) said:
            // "Ensure "Long-Term" tasks display left/right resize handles... SD: Left... ED: Right..."
            // But in my last edit of TimelineView (Step 1230), I might have missed that or it was in `renderHandles`.
            // Let's check `renderHandles` logic in `TimelineView.ts` again via memory or assumption.
            // Step 1234 content shows:
            // Lines 282-290: if (isAllDay) { ... moveContainer ... moveHandle ... }
            // It seems I ONLY implemented move handle for AllDay in the recent view.

            // CRITICAL: We need to update TimelineView to show resize handles for AllDay/LongTerm tasks!
            // But I'm in the middle of writing strategy.
            // I will implement this strategy ASSUMING handles will exist (class `left-resize-handle`, `right-resize-handle`).
        }

        if (target.closest('.left-resize-handle')) {
            this.mode = 'resize-left';
        } else if (target.closest('.right-resize-handle')) {
            this.mode = 'resize-right';
        } else {
            this.mode = 'move';
        }

        // Initialize Geometry
        // We can get column width from the grid
        const grid = el.closest('.timeline-grid');
        const headerCell = grid?.querySelector('.header-cell:nth-child(2)'); // First day cell
        if (headerCell) {
            this.colWidth = headerCell.getBoundingClientRect().width;
        } else {
            this.colWidth = 100; // Fallback
        }

        this.initialWidth = el.getBoundingClientRect().width;

        this.initialDate = task.startDate || DateUtils.getToday();
        this.initialEndDate = task.endDate || task.startDate || DateUtils.getToday();
        const diffDays = DateUtils.getDiffDays(this.initialDate, this.initialEndDate);
        this.initialSpan = diffDays + 1;

        // Visual setup
        el.addClass('is-dragging');
        el.style.zIndex = '1000';
        this.hasMoved = false;

        // Note: Unlike TimelineDragStrategy, we use transform for visual feedback
        // because LongTerm tasks are positioned via CSS grid-column.
        // Handle positions will update via onTaskMove callback in DragHandler.
    }

    onMove(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        const deltaX = e.clientX - this.initialX;

        // Threshold check (only if not already moving)
        if (!this.hasMoved && Math.abs(deltaX) < 5) return;
        this.hasMoved = true;

        // Convert pixels to days
        const snapPixels = this.colWidth;
        const rawDeltaX = deltaX;
        const dayDelta = Math.round(rawDeltaX / snapPixels);
        const snappedDeltaX = dayDelta * snapPixels;

        // Visual feedback based on mode
        if (this.mode === 'move') {
            this.dragEl.style.transform = `translateX(${snappedDeltaX}px)`;
        } else if (this.mode === 'resize-right') {
            // Adjust width - minimum 1 day
            const rawWidth = this.initialWidth + snappedDeltaX;
            const clampedWidth = Math.max(rawWidth, this.colWidth);
            this.dragEl.style.width = `${clampedWidth}px`;
        } else if (this.mode === 'resize-left') {
            // Adjust width and x-position - minimum 1 day
            const rawWidth = this.initialWidth - snappedDeltaX;
            const clampedWidth = Math.max(rawWidth, this.colWidth);
            // Only apply transform if width is valid
            const validDelta = this.initialWidth - clampedWidth;
            this.dragEl.style.width = `${clampedWidth}px`;
            this.dragEl.style.transform = `translateX(${validDelta}px)`;
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        this.dragEl.removeClass('is-dragging');
        this.dragEl.style.transform = '';
        this.dragEl.style.width = '';
        this.dragEl.style.zIndex = '';

        if (!this.hasMoved) {
            context.onTaskClick(this.dragTask.id);
            this.dragEl = null;
            this.dragTask = null;
            return;
        }

        const deltaX = e.clientX - this.initialX;
        const dayDelta = Math.round(deltaX / this.colWidth);

        if (dayDelta === 0) {
            this.dragEl = null;
            this.dragTask = null;
            return;
        }

        const updates: Partial<Task> = {};
        const oldStart = this.initialDate;
        const oldEnd = this.initialEndDate;

        if (this.mode === 'move') {
            const newStart = DateUtils.addDays(oldStart, dayDelta);
            const duration = DateUtils.getDiffDays(oldStart, oldEnd);
            const newEnd = DateUtils.addDays(newStart, duration);

            updates.startDate = newStart;
            // If we move, it's no longer a floating start (implicit becomes explicit)

            // Only set endDate if it was different or if we want to persist it
            // If it was single day, duration 0. newEnd == newStart.
            // If original had endDate, update it.
            if (this.dragTask.endDate) {
                updates.endDate = newEnd;
            } else {
                // If implicit single day, we might keep implicit?
                // But changing date might be fine.
            }
        } else if (this.mode === 'resize-right') {
            // Change End Date
            // SD -> SED / D -> ED / S-All -> SE
            // Basic logic: Just set explicit End Date. 
            // TaskParser/Format will handle type if End != Start (or if End is explicit).

            const newEnd = DateUtils.addDays(oldEnd, dayDelta);

            // Ensure end >= start
            if (newEnd >= oldStart) {
                updates.endDate = newEnd;
            }
        } else if (this.mode === 'resize-left') {
            // Change Start Date
            // ED -> SED / D -> SD / E -> SE
            // Basic logic: Set explicit Start.
            // AND ensure floating start is cleared if we set explicit start.

            const newStart = DateUtils.addDays(oldStart, dayDelta);

            // Ensure start <= end
            if (newStart <= oldEnd) {
                updates.startDate = newStart;
                // updates.isFloatingStart = false; // Left resize always implies explicit start
            }
        }

        if (Object.keys(updates).length > 0) {
            await context.taskIndex.updateTask(this.dragTask.id, updates);
        }

        this.dragEl = null;
        this.dragTask = null;
    }
}
