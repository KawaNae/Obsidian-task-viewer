import { DragStrategy, DragContext } from '../DragStrategy';
import { Notice } from 'obsidian';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { createGhostElement, removeGhostElement } from '../GhostFactory';

export class AllDayDragStrategy implements DragStrategy {
    name = 'AllDay';

    private dragTask: Task | null = null;
    private dragEl: HTMLElement | null = null;
    private ghostEl: HTMLElement | null = null;
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
    private container: HTMLElement | null = null;
    private lastHighlighted: HTMLElement | null = null;
    private isOutsideSection: boolean = false;
    private refHeaderCell: HTMLElement | null = null;
    private initialGridColumn: string = '';

    // We rely on grid columns for snapping.
    // 1 col = 1 day.

    onDown(e: PointerEvent, task: Task, el: HTMLElement, context: DragContext) {
        this.dragTask = task;
        this.dragEl = el;
        this.initialX = e.clientX;
        this.container = context.container;

        // Determine Mode
        const target = e.target as HTMLElement;
        if (target.closest('.task-card__handle--resize-left, .task-card__handle--resize-right')) {
            // AllDay/LongTerm resize handles detected
        }

        if (target.closest('.task-card__handle--resize-left')) {
            this.mode = 'resize-left';
        } else if (target.closest('.task-card__handle--resize-right')) {
            this.mode = 'resize-right';
        } else {
            this.mode = 'move';
        }


        // Initialize Geometry
        // We can get column width from the grid
        const grid = el.closest('.timeline-grid');
        const headerCell = grid?.querySelector('.date-header__cell:nth-child(2)') as HTMLElement; // First day cell
        this.refHeaderCell = headerCell;

        if (headerCell) {
            this.colWidth = headerCell.getBoundingClientRect().width;
        } else {
            this.colWidth = 100; // Fallback
        }

        this.initialWidth = el.getBoundingClientRect().width;

        // Get view start date from context (spec: use view start date for E/ED/D types)
        // This is safe because TimelineView provides the start date via context
        const viewStartDate = context.getViewStartDate();

        this.initialDate = task.startDate || viewStartDate || DateUtils.getToday();
        this.initialEndDate = task.endDate || this.initialDate;
        const diffDays = DateUtils.getDiffDays(this.initialDate, this.initialEndDate);
        this.initialSpan = diffDays + 1;


        // Parse startCol from gridColumn style (e.g., "3 / span 2" → startCol = 3)
        const gridCol = el.style.gridColumn;
        const colMatch = gridCol.match(/^(\d+)\s*\/\s*span\s+(\d+)$/);
        if (colMatch) {
            this.startCol = parseInt(colMatch[1]);
        } else {
            // Fallback: calculate from date
            this.startCol = 2; // Default
        }

        // Save initial gridColumn for potential reset on cancel
        this.initialGridColumn = el.style.gridColumn;

        // Visual setup
        el.addClass('is-dragging');
        el.style.zIndex = '1000';
        this.hasMoved = false;
        this.isOutsideSection = false;

        // Create ghost element for cross-section dragging (move mode only)
        if (this.mode === 'move') {
            const doc = context.container.ownerDocument || document;
            this.ghostEl = createGhostElement(el, doc, { useCloneNode: true });
        }

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
        let dayDelta = Math.round(rawDeltaX / snapPixels);

        // Clamp to prevent dragging before column 2 (axis cell is column 1)
        const minColOffset = 2 - this.startCol; // How far left we can go before hitting axis
        if (dayDelta < minColOffset) {
            dayDelta = minColOffset;
        }

        const snappedDeltaX = dayDelta * snapPixels;

        // Visual feedback based on mode
        if (this.mode === 'move') {
            // Check if cursor is outside the long-term section
            const doc = context.container.ownerDocument || document;
            const elBelow = doc.elementFromPoint(e.clientX, e.clientY);
            const timelineSection = elBelow?.closest('.day-timeline-column');
            const wasOutside = this.isOutsideSection;
            this.isOutsideSection = !!(timelineSection);

            console.log('[LongTermDrag] isOutsideSection:', this.isOutsideSection, 'timelineSection:', !!timelineSection);

            // Update ghost and card visibility based on section
            if (this.isOutsideSection && this.ghostEl) {
                // Outside LT section: show ghost, reset original to initial position
                this.ghostEl.style.opacity = '0.8';
                this.ghostEl.style.left = `${e.clientX + 10}px`;
                this.ghostEl.style.top = `${e.clientY + 10}px`;
                this.dragEl.style.opacity = '0.3';

                // Keep task card at initial position (no transform, original gridColumn)
                this.dragEl.style.transform = '';
                this.dragEl.style.gridColumn = this.initialGridColumn;

                // Reset arrow to initial position
                const originalEndLine = this.startCol + this.initialSpan;
                this.updateArrowPosition(originalEndLine);
            } else if (this.ghostEl) {
                // Inside LT section: hide ghost, move original
                this.ghostEl.style.opacity = '0';
                this.ghostEl.style.left = '-9999px';
                this.dragEl.style.opacity = '';
                this.dragEl.style.transform = `translateX(${snappedDeltaX}px)`;

                // Update arrow: keep deadline end fixed, stretch arrow start
                const newTaskEndLine = this.startCol + this.initialSpan + dayDelta;
                this.updateArrowPosition(newTaskEndLine);
            }

            // Update cross-section drop zone highlighting
            this.updateDropZoneHighlight(e, context);
        } else if (this.mode === 'resize-right') {
            if (!this.refHeaderCell) return;
            const baseX = this.refHeaderCell.getBoundingClientRect().left;

            // Use relative width for intuitive snapping
            const taskLeft = baseX + (this.startCol - 2) * this.colWidth;
            const widthPx = e.clientX - taskLeft;

            // Snap to cell right edge (Ceil)
            const newSpan = Math.max(1, Math.ceil(widthPx / this.colWidth));

            // Use gridColumn instead of width for proper Grid alignment
            // This ensures End aligns to cell boundary (left of divider line)
            this.dragEl.style.gridColumn = `${this.startCol} / span ${newSpan}`;

            const taskEndLine = this.startCol + newSpan;
            this.updateArrowPosition(taskEndLine);
        } else if (this.mode === 'resize-left') {
            if (!this.refHeaderCell) return;
            const baseX = this.refHeaderCell.getBoundingClientRect().left;
            const colIndex = Math.floor((e.clientX - baseX) / this.colWidth);

            // New Start Col = colIndex + 2.
            let targetStartCol = colIndex + 2;

            // Limit: Start <= End. End Col is fixed based on initial state.
            const currentEndCol = this.startCol + this.initialSpan - 1;
            targetStartCol = Math.min(targetStartCol, currentEndCol);

            // New Span
            const newSpan = Math.max(1, currentEndCol - targetStartCol + 1);

            // Use gridColumn instead of width/transform for proper Grid alignment
            this.dragEl.style.gridColumn = `${targetStartCol} / span ${newSpan}`;
        }
    }

    async onUp(e: PointerEvent, context: DragContext) {
        if (!this.dragTask || !this.dragEl) return;

        // Clear any remaining highlights
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        // Reset cursor immediately
        document.body.style.cursor = '';

        // Clean up ghost element
        removeGhostElement(this.ghostEl);
        this.ghostEl = null;

        this.dragEl.removeClass('is-dragging');
        this.dragEl.style.transform = '';
        this.dragEl.style.width = '';
        this.dragEl.style.zIndex = '';
        this.dragEl.style.opacity = '';

        if (!this.hasMoved) {
            context.onTaskClick(this.dragTask.id);
            this.dragEl = null;
            this.dragTask = null;
            return;
        }

        // Check for cross-section drops first
        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);

        if (elBelow) {


            // Check for drop on Timeline section (LT→TL)
            const timelineSection = elBelow.closest('.day-timeline-column') as HTMLElement;
            if (timelineSection && this.mode === 'move') {
                const targetDate = timelineSection.dataset.date;
                if (targetDate) {
                    // Calculate drop position for time
                    const rect = timelineSection.getBoundingClientRect();
                    const yInContainer = e.clientY - rect.top;

                    const zoomLevel = context.plugin.settings.zoomLevel;
                    const snapPixels = 15 * zoomLevel;
                    const snappedTop = Math.round(yInContainer / snapPixels) * snapPixels;

                    const startHour = context.plugin.settings.startHour;
                    const startHourMinutes = startHour * 60;
                    const minutesFromStart = snappedTop / zoomLevel;
                    const totalMinutes = startHourMinutes + minutesFromStart;

                    let finalStartDate = targetDate;
                    if (totalMinutes >= 24 * 60) {
                        finalStartDate = DateUtils.addDays(targetDate, 1);
                    }

                    const updates: Partial<Task> = {
                        startDate: finalStartDate,
                        startTime: DateUtils.minutesToTime(totalMinutes),
                        endTime: DateUtils.minutesToTime(totalMinutes + 60), // 1h default
                        endDate: finalStartDate
                    };

                    // If task has deadline, preserve it but convert to timed format
                    if (this.dragTask.deadline) {
                        // Keep deadline as SD type (start+end times, deadline date)
                        updates.endDate = undefined; // Remove explicit end date for SD type
                    }

                    await context.taskIndex.updateTask(this.dragTask.id, updates);
                    this.dragEl = null;
                    this.dragTask = null;
                    this.container = null;
                    return;
                }
            }
        }

        // Regular long-term movement/resize within same section
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

            // Determine task type for proper conversion
            const hasExplicitStart = !!this.dragTask.startDate;
            const hasExplicitEnd = !!this.dragTask.endDate;
            const hasDeadline = !!this.dragTask.deadline;

            if (hasExplicitStart && hasExplicitEnd) {
                // SED/SE型: 両方の日付を更新
                updates.startDate = newStart;
                updates.endDate = newEnd;
            } else if (hasExplicitStart && !hasExplicitEnd && hasDeadline) {
                // SD型: startとendを設定してSED型に変換、deadlineはそのまま
                updates.startDate = newStart;
                updates.endDate = newEnd;
            } else if (!hasExplicitStart && hasExplicitEnd && hasDeadline) {
                // ED型: startとendを設定してSED型に変換、deadlineはそのまま
                updates.startDate = newStart;
                updates.endDate = newEnd;
            } else if (!hasExplicitStart && hasExplicitEnd && !hasDeadline) {
                // E型: startとendを設定してSE型に変換
                updates.startDate = newStart;
                updates.endDate = newEnd;
            } else if (!hasExplicitStart && !hasExplicitEnd && hasDeadline) {
                // D型: startを設定してS-All型に変換、deadlineはそのまま
                updates.startDate = newStart;
                // endDateは設定しない（S-All型は1日タスク）
            } else if (hasExplicitStart && !hasExplicitEnd && !hasDeadline) {
                // S-All型: startのみ更新
                updates.startDate = newStart;
            } else {
                // その他: startとendを更新
                updates.startDate = newStart;
                if (this.dragTask.endDate) {
                    updates.endDate = newEnd;
                }
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
        this.container = null;
    }

    private updateArrowPosition(taskEndGridLine: number) {
        if (!this.dragEl || !this.dragEl.dataset.id || !this.container) return;

        const taskId = this.dragEl.dataset.id;
        const arrow = this.container.querySelector(`.deadline-arrow[data-task-id="${taskId}"]`) as HTMLElement;
        if (arrow) {
            arrow.style.gridColumnStart = taskEndGridLine.toString();
            const arrowEnd = parseInt(arrow.style.gridColumnEnd) || 0;
            if (taskEndGridLine >= arrowEnd) {
                arrow.style.display = 'none';
            } else {
                arrow.style.display = '';
            }
        }
    }

    private moveArrowWithTask(translateX: number) {
        if (!this.dragEl || !this.dragEl.dataset.id || !this.container) return;

        const taskId = this.dragEl.dataset.id;
        const arrow = this.container.querySelector(`.deadline-arrow[data-task-id="${taskId}"]`) as HTMLElement;
        if (arrow) {
            arrow.style.transform = `translateX(${translateX}px)`;
        }
    }

    private updateDropZoneHighlight(e: PointerEvent, context: DragContext) {
        // Only highlight drop zones during move operations
        if (this.mode !== 'move') return;

        const doc = context.container.ownerDocument || document;
        const elBelow = doc.elementFromPoint(e.clientX, e.clientY);

        // Reset cursor by default
        document.body.style.cursor = '';
        if (this.ghostEl) this.ghostEl.removeClass('is-invalid');

        // Clear previous highlight
        if (this.lastHighlighted) {
            this.lastHighlighted.removeClass('drag-over');
            this.lastHighlighted = null;
        }

        if (!elBelow) return;

        const timelineCol = elBelow.closest('.day-timeline-column') as HTMLElement;

        if (timelineCol) {
            timelineCol.addClass('drag-over');
            this.lastHighlighted = timelineCol;
        }
    }

    /**
     * Reset visual state when drag operation is cancelled.
     * Restores gridColumn and arrow position to initial state.
     */
    private resetVisualState() {
        if (!this.dragEl) return;

        // Reset task card gridColumn
        this.dragEl.style.gridColumn = this.initialGridColumn;
        this.dragEl.style.transform = '';
        this.dragEl.style.opacity = '';
        this.dragEl.removeClass('is-dragging');

        // Reset arrow position
        if (this.container && this.dragEl.dataset.id) {
            const taskId = this.dragEl.dataset.id;
            const arrow = this.container.querySelector(`.deadline-arrow[data-task-id="${taskId}"]`) as HTMLElement;
            if (arrow) {
                // Reset arrow to original position based on initial span
                const originalEndLine = this.startCol + this.initialSpan;
                arrow.style.gridColumnStart = originalEndLine.toString();
                arrow.style.transform = '';
                arrow.style.display = '';
            }
        }
    }
}

