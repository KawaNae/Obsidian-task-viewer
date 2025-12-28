import { DragStrategy } from './DragStrategy';
import { Task, TaskViewerSettings } from '../../types';

export class UnassignedDragStrategy implements DragStrategy {
    name = 'UnassignedDragStrategy';
    private dragEl: HTMLElement | null = null;
    private settings: TaskViewerSettings;

    private targetSection: 'unassigned' | 'all-day' | 'timeline' | null = null;
    private currentDayDate: string | null = null;
    private dropTime: string | null = null;

    constructor(settings: TaskViewerSettings) {
        this.settings = settings;
    }

    onDragStart(task: Task, el: HTMLElement, initialX: number, initialY: number, container: HTMLElement): void {
        this.dragEl = el;
        this.targetSection = 'unassigned';
    }

    onDragMove(e: PointerEvent, container: HTMLElement, elBelow: Element | null): void {
        if (!this.dragEl) return;

        const longTermRow = elBelow?.closest('.long-term-row') as HTMLElement;
        const dayTimelineCol = elBelow?.closest('.day-timeline-column') as HTMLElement;
        const unassignedSection = elBelow?.closest('.unassigned-section') as HTMLElement;

        if (longTermRow) {
            this.handleCrossSectionMove(longTermRow, 'all-day'); // Treat as 'all-day' logic (Date Task)
            // We need to determine the date from columns!
            this.updateDateFromGrid(e, container, longTermRow);
        } else if (dayTimelineCol) {
            this.handleCrossSectionMove(dayTimelineCol, 'timeline');
            if (dayTimelineCol.dataset.startDate) this.currentDayDate = dayTimelineCol.dataset.startDate;
            this.calculateTimelineDrop(e, dayTimelineCol);
        } else if (unassignedSection) {
            this.handleCrossSectionMove(unassignedSection, 'unassigned');
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
                    if (date) this.currentDayDate = date;
                }
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
            this.dragEl.removeClass('all-day');

            if (section === 'all-day') {
                this.dragEl.addClass('long-term-task');
                this.dragEl.style.gridRow = '1'; // Force row 1 in grid
            } else if (section === 'timeline') {
                this.dragEl.addClass('timed');
                this.dragEl.style.position = 'absolute';
                this.dragEl.style.width = 'calc(100% - 8px)';
                this.dragEl.style.left = '4px';
            }
        }
    }

    private calculateTimelineDrop(e: PointerEvent, dayCol: HTMLElement) {
        if (!this.dragEl || this.targetSection !== 'timeline') return;

        const zoomLevel = this.settings.zoomLevel;
        const hourHeight = 60 * zoomLevel;
        const snapPixels = hourHeight / 4; // 15 min

        const containerRect = dayCol.getBoundingClientRect();

        let relativeY = e.clientY - containerRect.top;
        const newTop = Math.round(relativeY / snapPixels) * snapPixels;
        const clampedTop = Math.max(0, newTop);

        this.dragEl.style.top = `${clampedTop}px`;
        this.dragEl.style.height = `${hourHeight}px`;

        // Calculate time string
        const startHour = this.settings.startHour;
        const startHourMinutes = startHour * 60;
        const startTotalMinutes = (clampedTop / zoomLevel) + startHourMinutes;

        const h = Math.floor(startTotalMinutes / 60);
        const m = Math.round(startTotalMinutes % 60);
        this.dropTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    async onDragEnd(task: Task, el: HTMLElement): Promise<Partial<Task>> {
        const updates: Partial<Task> = {};

        if (this.targetSection === 'all-day' && this.currentDayDate) {
            // Future -> All-Day
            updates.startDate = this.currentDayDate;
            updates.isFuture = undefined; // Remove 'someday'
            updates.startTime = undefined;
            updates.endTime = undefined;
            updates.endDate = undefined;
        } else if (this.targetSection === 'timeline' && this.currentDayDate && this.dropTime) {
            // Future -> Timeline
            updates.startDate = this.currentDayDate;
            updates.isFuture = undefined;
            updates.startTime = this.dropTime;
            updates.endTime = undefined; // Point or 1h default
            updates.endDate = undefined;
        } else if (this.targetSection === 'unassigned') {
            // Stay/Reorder in Future (No-op data change unless reordering is implemented)
            // But if we want to ensure it stays 'someday' just in case:
            if (task.isFuture !== true) {
                // Should not happen if started as Unassigned but good safeguard
            }
        }

        return updates;
    }

    cleanup() {
        this.dragEl = null;
        this.targetSection = null;
        this.currentDayDate = null;
        this.dropTime = null;
    }
}
