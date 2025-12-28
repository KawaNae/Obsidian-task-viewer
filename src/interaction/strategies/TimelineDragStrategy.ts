import { DragStrategy } from './DragStrategy';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { TaskViewerSettings } from '../../types';

export class TimelineDragStrategy implements DragStrategy {
    name = 'TimelineDragStrategy';
    private dragEl: HTMLElement | null = null;
    private initialHeight: number = 0;
    private initialTop: number = 0;
    private grabOffsetY: number = 0;
    private mode: 'move' | 'resize-top' | 'resize-bottom' | null = null;
    private currentDayDate: string | null = null;
    private settings: TaskViewerSettings;

    // Track target section for cross-section moves
    private targetSection: 'timeline' | 'all-day' | 'unassigned' | 'long-term' | null = null;

    constructor(settings: TaskViewerSettings) {
        this.settings = settings;
    }

    onDragStart(task: Task, el: HTMLElement, initialX: number, initialY: number, container: HTMLElement): void {
        this.dragEl = el;
        const rect = el.getBoundingClientRect();
        this.initialTop = parseInt(el.style.top || '0');
        this.initialHeight = parseInt(el.style.height || '0');
        this.grabOffsetY = initialY - rect.top;

        // Initial state
        this.targetSection = 'timeline';

        // Mode is set by Manager via setMode before this is called
    }

    setMode(mode: 'move' | 'resize-top' | 'resize-bottom') {
        this.mode = mode;
    }

    onDragMove(e: PointerEvent, container: HTMLElement, elBelow: Element | null): void {
        if (!this.dragEl) return;

        // Detect Sections
        const dayCol = elBelow?.closest('.day-timeline-column') as HTMLElement;
        const unassignedSection = elBelow?.closest('.unassigned-section') as HTMLElement;
        const longTermRow = elBelow?.closest('.long-term-row') as HTMLElement;


        if (this.mode === 'move') {
            if (longTermRow && !dayCol) {
                // Unified Date Section
                this.handleCrossSectionMove(longTermRow, 'long-term', 'long-term-task');
                // Update context if we want to capture specific date?
                // Usually long-term row is just the container. 
                // We don't necessarily update `currentDayDate` from row container unless we do grid calc.
                // But TimelineStrategy -> LongTerm puts it in D-Type usually (no dates?). 
                // Spec says: "Timeline -> Long Term: Convert to D type (remove start/end)".
                // So we don't strictly need the specific column date for the Conversion Logic (it becomes Unscheduled Date Task effectively? Or just D type).
                // Wait, D type = "Deadline only". 
            } else if (unassignedSection) {
                this.handleCrossSectionMove(unassignedSection, 'unassigned', 'unassigned');
            }
        }

        if (dayCol) {
            this.targetSection = 'timeline';

            // Re-parent / Visual Feedback for Timeline
            if (this.dragEl.parentElement !== dayCol) {
                dayCol.appendChild(this.dragEl);
                this.currentDayDate = dayCol.dataset.startDate || null;

                // Restore Timeline Styles
                this.dragEl.style.position = 'absolute';
                this.dragEl.style.width = 'calc(100% - 8px)';
                this.dragEl.style.left = '4px';
                this.dragEl.removeClass('all-day');
                this.dragEl.addClass('timed');
            } else {
                if (dayCol.dataset.startDate) this.currentDayDate = dayCol.dataset.startDate;
            }

            // Snap Logic (Only apply if in Timeline)
            if (this.mode) {
                this.applyTimelineSnap(e, dayCol);
            }
        }
    }

    private handleCrossSectionMove(targetContainer: HTMLElement, section: 'all-day' | 'unassigned' | 'long-term', cssClass: string) {
        if (this.dragEl && this.dragEl.parentElement !== targetContainer) {
            this.targetSection = section;
            targetContainer.appendChild(this.dragEl);

            // Visual reset for non-timeline
            this.dragEl.style.position = '';
            this.dragEl.style.top = '';
            this.dragEl.style.left = '';
            this.dragEl.style.width = '';
            this.dragEl.style.height = '';

            this.dragEl.removeClass('timed');
            this.dragEl.removeClass('all-day'); // reset

            if (section === 'long-term' || section === 'all-day') this.dragEl.addClass('long-term-task');
            // Unassigned/LongTerm might rely on default or specific classes if needed
        }
    }

    private applyTimelineSnap(e: PointerEvent, dayCol: HTMLElement) {
        if (!this.dragEl) return;
        const zoomLevel = this.settings.zoomLevel;
        const hourHeight = 60 * zoomLevel;
        const snapPixels = hourHeight / 4; // 15 min

        const containerRect = dayCol.getBoundingClientRect();
        let relativeY = (e.clientY - containerRect.top) - this.grabOffsetY;

        if (this.mode === 'move') {
            const newTop = Math.round(relativeY / snapPixels) * snapPixels;
            const clampedTop = Math.max(0, newTop);
            this.dragEl.style.top = `${clampedTop}px`;
        } else if (this.mode === 'resize-top') {
            const currentTop = parseInt(this.dragEl.style.top || '0');
            const currentHeight = parseInt(this.dragEl.style.height || `${60 * zoomLevel}`);
            const currentBottom = currentTop + currentHeight;
            const rawNewTop = Math.round(((e.clientY - containerRect.top) / snapPixels)) * snapPixels;
            const newTop = Math.min(rawNewTop, currentBottom - snapPixels);
            const clampedTop = Math.max(0, newTop);
            const newHeight = currentBottom - clampedTop;
            this.dragEl.style.top = `${clampedTop + 1}px`;
            this.dragEl.style.height = `${newHeight - 3}px`;
        } else if (this.mode === 'resize-bottom') {
            const currentTop = parseInt(this.dragEl.style.top || '0');
            const relativeMouseY = e.clientY - containerRect.top;
            const rawNewBottom = Math.round(relativeMouseY / snapPixels) * snapPixels;
            const newHeight = Math.max(snapPixels, rawNewBottom - currentTop);
            this.dragEl.style.height = `${newHeight - 3}px`;
        }
    }

    async onDragEnd(task: Task, el: HTMLElement): Promise<Partial<Task>> {
        const updates: Partial<Task> = {};

        if (this.targetSection === 'all-day') {
            // Timeline (SE/Timed) -> All-Day
            // Spec: Remove start time, delete end completely.
            // S-Timed: Remove start time.
            if (this.currentDayDate) {
                updates.startDate = this.currentDayDate;
            }
            updates.startTime = undefined;
            updates.endTime = undefined;
            updates.endDate = undefined; // Force delete end per spec

        } else if (this.targetSection === 'unassigned') {
            // Timeline -> Future
            // Spec: start -> future, delete end.
            updates.startDate = undefined;
            updates.isFuture = true; // future
            updates.startTime = undefined;
            updates.endDate = undefined;
            updates.endTime = undefined;

        } else if (this.targetSection === 'long-term') {
            // Timeline (SED < 24h) -> Long Term
            // Spec: Convert to D type (remove start/end).
            updates.startDate = undefined;
            updates.startTime = undefined;
            updates.endDate = undefined;
            updates.endTime = undefined;
            updates.isFuture = undefined;

        } else if (this.targetSection === 'timeline') {
            // Standard Timeline Logic
            if (!this.currentDayDate || !this.dragEl) return {};

            const top = parseInt(this.dragEl.style.top || '0');
            const zoomLevel = this.settings.zoomLevel;
            const height = parseInt(this.dragEl.style.height || `${60 * zoomLevel}`);
            const logicalTop = Math.max(0, top - 1);

            const startHour = this.settings.startHour;
            const startHourMinutes = startHour * 60;
            const startTotalMinutes = (logicalTop / zoomLevel) + startHourMinutes;
            const endTotalMinutes = startTotalMinutes + ((height + 3) / zoomLevel);

            const newStart = this.calcDateAndTime(this.currentDayDate, startTotalMinutes);
            const newEnd = this.calcDateAndTime(this.currentDayDate, endTotalMinutes);

            const isFuture = task.isFuture;
            const hasStart = !!task.startDate && !isFuture;
            const hasEnd = !!task.endDate || !!task.endTime;
            const hasDeadline = !!task.deadline;

            if (isFuture || (!hasStart && !hasEnd && !hasDeadline)) {
                // Future/Unassigned dragged to Timeline (Wait, this is UnassignedStrategy territory usually, but what if converted mid-drag? Unlikely unless strategy allows swap. But TimelineStrategy handles "Timeline items".)
                // If we had a "Future being dragged in TimelineStrategy", it would mean we handle it here. 
                // But for now, this handles "Already Timed Task moved within Timeline".

                // However, spec allows moving Timed Task to another day/time in Timeline.
                updates.startDate = newStart.startDate;
                updates.startTime = newStart.time;
                updates.endTime = newEnd.time;
                if (newStart.startDate !== newEnd.startDate) updates.endDate = newEnd.startDate;
                if (isFuture) updates.isFuture = undefined;
            } else {
                if (this.mode === 'move') {
                    updates.startDate = newStart.startDate;
                    updates.startTime = newStart.time;
                    if (hasEnd || task.endTime) {
                        updates.endDate = newEnd.startDate;
                        updates.endTime = newEnd.time;
                    }
                    // Ensure end date consistency if simple move
                    // Calculate duration? No, we used newStart/newEnd logic above which preserves duration if height preserved.
                    // The logic above recalculates end based on height. This is correct for move too.
                } else if (this.mode === 'resize-top') {
                    updates.startDate = newStart.startDate;
                    updates.startTime = newStart.time;
                } else if (this.mode === 'resize-bottom') {
                    updates.endDate = newEnd.startDate;
                    updates.endTime = newEnd.time;
                }
            }
        }

        return updates;
    }

    cleanup() {
        this.dragEl = null;
        this.mode = null;
        this.currentDayDate = null;
        this.targetSection = null;
    }

    private calcDateAndTime(baseDate: string, totalMinutes: number): { startDate: string, time: string } {
        const d = new Date(baseDate);
        const addDays = Math.floor(totalMinutes / (24 * 60));
        const remMinutes = totalMinutes % (24 * 60);

        d.setDate(d.getDate() + addDays);
        const dateStr = d.toISOString().split('T')[0];

        const h = Math.floor(remMinutes / 60);
        const m = Math.round(remMinutes % 60);
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        return { startDate: dateStr, time: timeStr };
    }
}
