import { DragStrategy } from './DragStrategy';
import { Task, TaskViewerSettings } from '../../types';

export class AllDayDragStrategy implements DragStrategy {
    name = 'AllDayDragStrategy';
    private dragEl: HTMLElement | null = null;
    private container: HTMLElement | null = null;
    private mode: 'move' | 'resize-left' | 'resize-right' | null = null;
    private currentDayDate: string | null = null;
    private settings: TaskViewerSettings;

    private targetSection: 'all-day' | 'timeline' | 'unassigned' | null = null;
    private dropTime: string | null = null; // Store calculated time for drop on timeline

    constructor(settings: TaskViewerSettings) {
        this.settings = settings;
    }

    onDragStart(task: Task, el: HTMLElement, initialX: number, initialY: number, container: HTMLElement): void {
        this.dragEl = el;
        this.container = container;
        this.targetSection = 'all-day'; // default
        // Mode is set by Manager via setMode before this is called
    }

    setMode(mode: 'move' | 'resize-left' | 'resize-right') {
        this.mode = mode;
    }

    onDragMove(e: PointerEvent, container: HTMLElement, elBelow: Element | null): void {
        if (!this.dragEl) return;

        // Unified Section Detection: 'long-term-row' now handles both
        const longTermRow = elBelow?.closest('.long-term-row') as HTMLElement;
        const dayTimelineCol = elBelow?.closest('.day-timeline-column') as HTMLElement;
        const unassignedSection = elBelow?.closest('.unassigned-section') as HTMLElement;

        if (this.mode === 'move') {
            if (longTermRow) {
                this.handleCrossSectionMove(longTermRow, 'all-day'); // 'all-day' internally equals 'long-term' here
                // Update Date Context via Grid Calculation
                this.updateDateFromGrid(e, container, longTermRow);
            } else if (unassignedSection) {
                this.handleCrossSectionMove(unassignedSection, 'unassigned');
            } else if (dayTimelineCol) {
                this.handleCrossSectionMove(dayTimelineCol, 'timeline');
                if (dayTimelineCol.dataset.startDate) this.currentDayDate = dayTimelineCol.dataset.startDate;

                // Calculate time for visual feedback or drop preparation
                this.calculateTimelineDrop(e, dayTimelineCol);
            }
        }

        // Resize Logic (works for both single and multi-day in the long-term row)
        if ((this.mode === 'resize-left' || this.mode === 'resize-right') && this.targetSection === 'all-day') {
            this.handleResizeGrid(e, container, elBelow);
        }
    }

    private updateDateFromGrid(e: PointerEvent, container: HTMLElement, row: HTMLElement) {
        const rowRect = row.getBoundingClientRect();
        const timeAxisWidth = 30;
        const xInRow = e.clientX - rowRect.left;

        if (xInRow > timeAxisWidth) {
            const firstCol = container.querySelector('.day-timeline-column');
            if (firstCol) {
                const colWidth = firstCol.getBoundingClientRect().width;
                const colIndex = Math.floor((xInRow - timeAxisWidth) / colWidth);
                const dayCols = Array.from(container.querySelectorAll('.day-timeline-column')) as HTMLElement[];

                if (colIndex >= 0 && colIndex < dayCols.length) {
                    const date = dayCols[colIndex].dataset.startDate;
                    if (date) {
                        this.currentDayDate = date;

                        // Visual Feedback: Move the task to this column
                        // Assuming single day move for now or maintain span?
                        // Let's assume maintain span.
                        const startGridLine = colIndex + 2;

                        // Calculate Current Span
                        const currentStart = parseInt(this.dragEl!.style.gridColumnStart) || 0;
                        const currentEnd = parseInt(this.dragEl!.style.gridColumnEnd) || 0;
                        const span = (currentEnd > currentStart) ? (currentEnd - currentStart) : 1;

                        if (this.dragEl) {
                            this.dragEl.style.gridColumnStart = startGridLine.toString();
                            this.dragEl.style.gridColumnEnd = (startGridLine + span).toString();

                            // Update Arrow
                            this.updateArrowPosition(startGridLine + span);
                        }
                    }
                }
            }
        }
    }

    private updateArrowPosition(taskEndGridLine: number) {
        if (!this.dragEl || !this.dragEl.dataset.id || !this.container) return;

        // Find the arrow associated with this task
        const taskId = this.dragEl.dataset.id;
        const arrow = this.container.querySelector(`.deadline-arrow[data-task-id="${taskId}"]`) as HTMLElement;

        if (arrow) {
            // Arrow starts where task ends (or used to?)
            // We want arrow start = taskEndGridLine
            arrow.style.gridColumnStart = taskEndGridLine.toString();
            // gridColumnEnd shouldn't change unless we want to keep it fixed deadline?
            // If task moves, deadline (absolute date) stays same?
            // Yes, usually. So end line is fixed.
            // If task moves past deadline? Arrow might flip or disappear. 
            // For now let's just update start. Logic handles valid rendering on redraw.

            // Check visibility
            const arrowEnd = parseInt(arrow.style.gridColumnEnd) || 0;
            if (taskEndGridLine >= arrowEnd) {
                arrow.style.display = 'none';
            } else {
                arrow.style.display = '';
            }
        }
    }

    private handleCrossSectionMove(targetContainer: HTMLElement, section: 'all-day' | 'timeline' | 'unassigned') {
        if (this.dragEl && this.dragEl.parentElement !== targetContainer) {
            this.targetSection = section;
            targetContainer.appendChild(this.dragEl);

            // Visual Reset
            this.dragEl.style.position = '';
            this.dragEl.style.top = '';
            this.dragEl.style.left = '';
            this.dragEl.style.width = '';
            this.dragEl.style.height = '';
            this.dragEl.style.gridColumnStart = '';
            this.dragEl.style.gridColumnEnd = '';

            this.dragEl.removeClass('timed');

            if (section === 'all-day') {
                this.dragEl.addClass('long-term-task'); // New Base Class
                // Reset to standard grid item styles for drag preview if needed,
                // But generally rendering puts it in grid.
                // For drag preview, we might want it to follow cursor or snap.
                // If it's a "move", we probably want to update grid columns on the fly or just absolute move?
                // Visual feedback: Snap to grid column immediately?

                // Let's rely on onDragMove calling updateDateFromGrid, we can update visual if we want.
                // But simply appending to row might make it jump.
                // For now, let's keep it simple: Add class, allow free float or basic snap?
                // Spec implies "Move handle operation" -> visual update.
                // But handleCrossSectionMove mainly re-parents.

                // Important: Unified grid items are positioned by grid-column.
                // When we drag a non-grid item (from timeline) into here, it needs grid styles.
                this.dragEl.style.position = ''; // Allows grid flow? No, grid items need specific column.
                // We should probably set a temporary grid column based on mouse position.
                // But simpler validation: Just re-parenting triggers CSS. grid-row=1.
                this.dragEl.style.gridRow = '1';

                // We need to calculate which column!
                // Implemented in onDragMove -> we update currentDayDate.
                // But visual feedback? we should set gridColumnStart/End to follow mouse.
                // Let's add that logic to updateDateFromGrid or separate.
            } else if (section === 'timeline') {
                this.dragEl.addClass('timed');
                this.dragEl.style.position = 'absolute';
                this.dragEl.style.width = 'calc(100% - 8px)';
                this.dragEl.style.left = '4px';
                // height set in calculation
            }
        }
    }

    private calculateTimelineDrop(e: PointerEvent, dayCol: HTMLElement) {
        if (!this.dragEl || this.targetSection !== 'timeline') return;

        const zoomLevel = this.settings.zoomLevel;
        const hourHeight = 60 * zoomLevel;
        const snapPixels = hourHeight / 4; // 15 min

        const containerRect = dayCol.getBoundingClientRect();
        // Since we re-parented, local Y is roughly e.clientY - containerRect.top
        // But we need to account for grabOffset... wait, AllDay tasks are small.
        // Let's assume cursor centers on the task or top?
        // For All-Day -> Timeline, we treat the cursor as the start time reference.

        let relativeY = e.clientY - containerRect.top;
        const newTop = Math.round(relativeY / snapPixels) * snapPixels;
        const clampedTop = Math.max(0, newTop);

        this.dragEl.style.top = `${clampedTop}px`;
        // Default duration 1 hour for converted task?
        this.dragEl.style.height = `${hourHeight}px`;

        // Calculate time string
        const startHour = this.settings.startHour;
        const startHourMinutes = startHour * 60;
        const startTotalMinutes = (clampedTop / zoomLevel) + startHourMinutes;

        const h = Math.floor(startTotalMinutes / 60);
        const m = Math.round(startTotalMinutes % 60);
        this.dropTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    private handleResizeGrid(e: PointerEvent, container: HTMLElement, elBelow: Element | null) {
        const row = elBelow?.closest('.timeline-row') || this.dragEl?.parentElement;
        if (row) {
            const rowRect = row.getBoundingClientRect();
            const timeAxisWidth = 30;
            const xInRow = e.clientX - rowRect.left;

            if (xInRow > timeAxisWidth) {
                const firstCol = container.querySelector('.day-timeline-column');
                if (firstCol) {
                    const colWidth = firstCol.getBoundingClientRect().width;
                    const colIndex = Math.floor((xInRow - timeAxisWidth) / colWidth);
                    if (colIndex >= 0) {
                        const gridLine = colIndex + 2;

                        if (this.mode === 'resize-left') {
                            const currentEnd = parseInt(this.dragEl!.style.gridColumnEnd || '0') || (gridLine + 1);
                            if (gridLine < currentEnd) {
                                this.dragEl!.style.gridColumnStart = gridLine.toString();
                                if (!this.dragEl!.style.gridColumnEnd) this.dragEl!.style.gridColumnEnd = currentEnd.toString();
                            }
                        } else if (this.mode === 'resize-right') {
                            const currentStart = parseInt(this.dragEl!.style.gridColumnStart || '0') || gridLine;
                            const targetLine = gridLine + 1;
                            if (targetLine > currentStart) {
                                this.dragEl!.style.gridColumnEnd = targetLine.toString();
                                if (!this.dragEl!.style.gridColumnStart) this.dragEl!.style.gridColumnStart = currentStart.toString();

                                // Update Arrow Start Position (Task End changed)
                                this.updateArrowPosition(targetLine);
                            }
                        }
                    }
                }
            }
        }
    }

    async onDragEnd(task: Task, el: HTMLElement): Promise<Partial<Task>> {
        const updates: Partial<Task> = {};

        if (this.targetSection === 'timeline' && this.currentDayDate && this.dropTime) {
            // All-Day -> Timeline
            updates.startDate = this.currentDayDate;
            updates.startTime = this.dropTime;
            updates.endTime = undefined;
            updates.endDate = undefined;
            updates.isFuture = undefined;

        } else if (this.targetSection === 'unassigned') {
            // All-Day -> Future
            updates.startDate = undefined;
            updates.isFuture = true;
            updates.startTime = undefined;
            updates.endTime = undefined;
            updates.endDate = undefined;

        } else if (this.targetSection === 'all-day') {
            if (this.mode === 'move') {
                if (this.currentDayDate) {
                    let durationDays = 0;
                    if (task.endDate) {
                        const start = new Date(task.startDate!);
                        const end = new Date(task.endDate);
                        durationDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24));
                    }

                    if (this.currentDayDate !== task.startDate) {
                        updates.startDate = this.currentDayDate;
                        if (durationDays > 0) {
                            const newStart = new Date(this.currentDayDate);
                            const newEnd = new Date(newStart);
                            newEnd.setDate(newEnd.getDate() + durationDays);
                            updates.endDate = newEnd.toISOString().split('T')[0];
                        } else {
                            if (task.endDate && task.endDate === task.startDate) {
                                updates.endDate = this.currentDayDate;
                            }
                        }

                        const isFuture = task.isFuture;
                        if (isFuture) updates.isFuture = undefined;
                    }

                    // IMPORTANT: Do NOT clear startTime/endTime - preserve existing times
                    // This is a date-precision operation, times should be kept as-is
                }
            }
            else if (this.mode === 'resize-left' || this.mode === 'resize-right') {
                if (!this.container) return {};

                const dayCols = Array.from(this.container.querySelectorAll('.day-timeline-column')) as HTMLElement[];
                if (dayCols.length === 0) return {};

                const startLine = parseInt(el.style.gridColumnStart);
                const endLine = parseInt(el.style.gridColumnEnd);

                // Determine current task type for conversion logic
                const hasDate = !!task.startDate;
                const hasEnd = !!task.endDate;
                const hasDeadline = !!task.deadline;

                if (this.mode === 'resize-left' && !isNaN(startLine)) {
                    const colIndex = startLine - 2;
                    if (colIndex >= 0 && colIndex < dayCols.length) {
                        const newDate = dayCols[colIndex].dataset.startDate;
                        if (newDate) {
                            updates.startDate = newDate;
                            // Type conversion: If task had no start, adding start changes type
                            // D垁E-> SD垁E E垁E-> SE垁E ED垁E-> SED垁E
                            // No additional changes needed - just setting date is enough
                        }
                    }
                }

                if (this.mode === 'resize-right' && !isNaN(endLine)) {
                    const colIndex = endLine - 3;
                    if (colIndex >= 0 && colIndex < dayCols.length) {
                        const newEndDate = dayCols[colIndex].dataset.startDate;
                        if (newEndDate) {
                            updates.endDate = newEndDate;
                            // Type conversion: If task had no end, adding end changes type
                            // D型-> ED型 S-All型-> SE型 SD型-> SED型
                            // No additional changes needed - just setting endDate is enough
                        }
                    }
                }

                // IMPORTANT: Do NOT clear startTime/endTime - preserve existing times
                // This is a date-precision operation, times should be kept as-is
                // deadline is also never modified in resize operations
            }
        }

        return updates;
    }

    cleanup() {
        this.dragEl = null;
        this.container = null;
        this.mode = null;
        this.currentDayDate = null;
        this.targetSection = null;
        this.dropTime = null;
    }
}
